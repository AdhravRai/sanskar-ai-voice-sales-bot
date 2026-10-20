
import json
import os
import uuid
from pathlib import Path
from datetime import datetime, timezone
from typing import Optional

from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from groq import Groq
from pydantic import BaseModel

from database import (
    RECORDINGS_DIR,
    create_call,
    get_all_calls,
    get_call,
    init_db,
)
from sales_analysis import analyze_sales_call

load_dotenv(Path(__file__).resolve().parent / ".env")

app = FastAPI(title="AI Voice Sales Bot API")

allowed_origins = os.getenv(
    "FRONTEND_ORIGINS",
    "http://localhost:5173,http://127.0.0.1:5173",
).split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in allowed_origins],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

groq_api_key = os.getenv("GROQ_API_KEY")
groq_client = Groq(api_key=groq_api_key) if groq_api_key else None

SYSTEM_PROMPT = """
You are FlowDesk's friendly, professional SaaS sales representative.

FlowDesk is a fictional sales and workflow management platform.
Your goal is to understand the customer's needs and explain how
FlowDesk may help. Ask one short question at a time.

Be conversational, concise, and honest. Do not invent product
features, prices, integrations, or guarantees. If the customer
asks for details that have not been provided, offer to arrange a
demo or have a sales representative follow up.

Never pressure the customer. If they decline, acknowledge their
decision politely. If they request a demo, confirm that the team
can follow up to arrange one; do not claim a booking has occurred.
"""

class ChatRequest(BaseModel):
    message: str
    history: list[dict] = []


@app.on_event("startup")
def startup():
    init_db()


@app.get("/")
def root():
    return {"message": "FlowDesk AI Voice Sales Bot API is running."}


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/api/chat")
def chat(request: ChatRequest):
    if not groq_client:
        raise HTTPException(
            status_code=500,
            detail="GROQ_API_KEY is missing from backend/.env",
        )

    messages = [{"role": "system", "content": SYSTEM_PROMPT}]

    for item in request.history[-12:]:
        role = item.get("role")
        content = item.get("content", "")

        if role in ("user", "assistant") and content:
            messages.append({"role": role, "content": content})

    messages.append({"role": "user", "content": request.message})

    try:
        response = groq_client.chat.completions.create(
            model="openai/gpt-oss-20b",
            messages=messages,
            max_completion_tokens=1024,
            temperature=0.5,
        )
        reply = response.choices[0].message.content

        if not reply:
            raise HTTPException(
                status_code=502,
                detail="The AI returned an empty response.",
            )

        return {"reply": reply.strip()}

    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"AI response failed: {str(exc)}",
        )


@app.post("/api/calls")
async def save_call(
    transcript: str = Form(...),
    duration_seconds: int = Form(0),
    consent: bool = Form(False),
    recording: Optional[UploadFile] = File(None),
):
    if not consent and recording is not None:
        raise HTTPException(
            status_code=400,
            detail="Recording upload requires consent.",
        )

    try:
        transcript_data = json.loads(transcript)
    except json.JSONDecodeError:
        raise HTTPException(
            status_code=400,
            detail="Transcript must be valid JSON.",
        )

    if not isinstance(transcript_data, list):
        raise HTTPException(
            status_code=400,
            detail="Transcript must be a list of messages.",
        )

    if duration_seconds < 0:
        raise HTTPException(
            status_code=400,
            detail="Duration cannot be negative.",
        )

    recording_path = None

    if recording is not None:
        allowed_types = {
            "audio/webm",
            "audio/webm;codecs=opus",
            "audio/ogg",
            "audio/mp4",
            "audio/mpeg",
            "audio/wav",
        }

        content_type = (recording.content_type or "").lower()

        if not content_type.startswith("audio/"):
            raise HTTPException(
                status_code=400,
                detail="Only audio recordings are accepted.",
            )

        extension = Path(recording.filename or "").suffix.lower()
        if extension not in {".webm", ".ogg", ".mp4", ".mp3", ".wav", ".m4a"}:
            extension = ".webm"

        filename = f"{uuid.uuid4().hex}{extension}"
        destination = RECORDINGS_DIR / filename

        try:
            contents = await recording.read()

            if len(contents) > 25 * 1024 * 1024:
                raise HTTPException(
                    status_code=413,
                    detail="Recording exceeds the 25 MB limit.",
                )

            destination.write_bytes(contents)
            recording_path = str(destination)
        finally:
            await recording.close()

    try:
        analysis = analyze_sales_call(transcript_data)

        call_id = create_call(
            transcript=transcript_data,
            duration_seconds=duration_seconds,
            consent=consent,
            recording_path=recording_path,
            analysis=analysis,
        )

        return {
            "id": call_id,
            "summary": analysis["summary"],
            "customer_requirements": analysis["customer_requirements"],
            "objections": analysis["objections"],
            "next_steps": analysis["next_steps"],
            "sales_status": analysis["sales_status"],
            "message": "Call saved successfully.",
        }

    except Exception as exc:
        if recording_path:
            try:
                Path(recording_path).unlink(missing_ok=True)
            except OSError:
                pass

        raise HTTPException(
            status_code=502,
            detail=f"Unable to analyze or save the call: {str(exc)}",
        )


def format_call(row):
    row["transcript"] = json.loads(row["transcript"])
    row["has_recording"] = bool(row.get("recording_path"))
    row.pop("recording_path", None)
    row["consent"] = bool(row["consent"])
    return row


@app.get("/api/calls")
def list_calls():
    return [format_call(call) for call in get_all_calls()]


@app.get("/api/calls/{call_id}")
def call_details(call_id: int):
    call = get_call(call_id)

    if not call:
        raise HTTPException(status_code=404, detail="Call not found.")

    return format_call(call)


@app.get("/api/calls/{call_id}/recording")
def get_recording(call_id: int):
    call = get_call(call_id)

    if not call:
        raise HTTPException(status_code=404, detail="Call not found.")

    if not call.get("consent"):
        raise HTTPException(
            status_code=403,
            detail="Recording consent was not provided.",
        )

    recording_path = call.get("recording_path")

    if not recording_path or not Path(recording_path).is_file():
        raise HTTPException(
            status_code=404,
            detail="No recording is available for this call.",
        )

    return FileResponse(
        path=recording_path,
        media_type="audio/webm",
        filename=Path(recording_path).name,
    )
