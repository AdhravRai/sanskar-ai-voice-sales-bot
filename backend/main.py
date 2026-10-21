
import os
import json
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from groq import Groq, APIError
from pydantic import BaseModel, Field

from database import (
    initialize_db,
    save_call,
    list_calls,
    get_call,
    RECORDINGS_DIR,
)
from sales_analysis import analyze_call


load_dotenv()

api_key = os.getenv("GROQ_API_KEY")
client = Groq(api_key=api_key) if api_key else None

app = FastAPI(title="Sankar AI Voice Sales Bot")

frontend_origins = [
    origin.strip().rstrip("/")
    for origin in os.getenv(
        "FRONTEND_ORIGINS",
        "http://localhost:5173,https://sanskar-ai-voice-sales-bot.vercel.app",
    ).split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=frontend_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

SYSTEM_PROMPT = """
You are a friendly, professional AI sales representative.

You are selling FlowDesk, a fictional SaaS product for small businesses.

Product details:
- Organizes team tasks and projects.
- Tracks deadlines and progress.
- Provides a shared team dashboard.
- Offers a fictional demo and a free trial.
- Pricing: $12 per user per month.

Your goals:
1. Understand the customer's needs.
2. Explain relevant product benefits clearly.
3. Answer questions using only the product details provided.
4. Handle objections respectfully without pressure.
5. Ask whether the customer wants a demo or trial when appropriate.

Keep replies concise and natural for spoken English.
Never claim a purchase or demo booking has occurred unless
the application has actually recorded that action.
Never invent product capabilities, discounts, or customer data.
"""


class ChatMessage(BaseModel):
    role: str
    content: str = Field(min_length=1, max_length=2000)


class ChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(min_length=1, max_length=30)


@app.get("/health")
def health():
    return {"status": "ok", "ai_configured": client is not None}


@app.post("/api/chat")
def chat(request: ChatRequest):
    if client is None:
        raise HTTPException(
            status_code=503,
            detail="GROQ_API_KEY is not configured.",
        )

    if any(m.role not in ("user", "assistant") for m in request.messages):
        raise HTTPException(status_code=400, detail="Invalid message role.")

    if request.messages[-1].role != "user":
        raise HTTPException(
            status_code=400,
            detail="The final message must be from the customer.",
        )

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        *[m.model_dump() for m in request.messages],
    ]

    try:
        result = client.chat.completions.create(
            model="openai/gpt-oss-20b",
            messages=messages,
            max_completion_tokens=1024,
        )

        reply = result.choices[0].message.content

        if not reply:
            raise HTTPException(
                status_code=502,
                detail="The AI returned an empty response.",
            )

        return {"reply": reply}

    except APIError as exc:
        raise HTTPException(
            status_code=502,
            detail=(
                "The AI provider request failed. "
                "Check your API limits and configuration."
            ),
        ) from exc


@app.on_event("startup")
def startup():
    initialize_db()


@app.post("/api/calls")
async def create_call(
    transcript: str = Form(...),
    duration_seconds: int = Form(...),
    consent: bool = Form(...),
    recording: UploadFile | None = File(None),
):
    if not consent:
        raise HTTPException(
            status_code=400,
            detail="Recording consent is required.",
        )

    if duration_seconds < 0 or duration_seconds > 86400:
        raise HTTPException(
            status_code=400,
            detail="Invalid call duration.",
        )

    try:
        messages = json.loads(transcript)

        if not isinstance(messages, list):
            raise ValueError("Transcript must be a list.")

        if len(messages) > 500:
            raise ValueError("Transcript is too long.")

        for message in messages:
            if (
                not isinstance(message, dict)
                or message.get("role") not in ("user", "assistant")
                or not isinstance(message.get("content"), str)
            ):
                raise ValueError("Invalid transcript message.")

    except (json.JSONDecodeError, ValueError) as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid transcript: {exc}",
        ) from exc

    recording_path = None

    if recording and recording.filename:
        if recording.content_type not in (
            "audio/webm",
            "audio/mp4",
            "audio/ogg",
            "audio/wav",
            "audio/mpeg",
        ):
            raise HTTPException(
                status_code=400,
                detail="Unsupported audio format.",
            )

        audio = await recording.read()

        if len(audio) > 20 * 1024 * 1024:
            raise HTTPException(
                status_code=413,
                detail="Recording must be smaller than 20 MB.",
            )

        if not audio:
            raise HTTPException(
                status_code=400,
                detail="Recording file is empty.",
            )

        extension = {
            "audio/webm": ".webm",
            "audio/mp4": ".mp4",
            "audio/ogg": ".ogg",
            "audio/wav": ".wav",
            "audio/mpeg": ".mp3",
        }[recording.content_type]

        filename = f"{uuid4().hex}{extension}"
        path = RECORDINGS_DIR / filename
        path.write_bytes(audio)
        recording_path = str(path)

    started_at = datetime.now(timezone.utc).isoformat()
    ended_at = started_at

    try:
        analysis = analyze_call(client, messages)
    except Exception as exc:
        if recording_path:
            Path(recording_path).unlink(missing_ok=True)

        raise HTTPException(
            status_code=502,
            detail="Call analysis failed. Check the AI provider and retry.",
        ) from exc

    call_id = save_call(
        started_at=started_at,
        ended_at=ended_at,
        duration_seconds=duration_seconds,
        transcript=json.dumps(messages),
        recording_path=recording_path,
        summary=analysis["summary"],
        customer_requirements=json.dumps(
            analysis["customer_requirements"]
        ),
        objections=json.dumps(analysis["objections"]),
        next_steps=json.dumps(analysis["next_steps"]),
        sales_status=analysis["sales_status"],
    )

    return {
        "id": call_id,
        "summary": analysis["summary"],
        "customer_requirements": analysis["customer_requirements"],
        "objections": analysis["objections"],
        "next_steps": analysis["next_steps"],
        "sales_status": analysis["sales_status"],
    }


@app.get("/api/calls")
def call_history():
    return {"calls": list_calls()}


@app.get("/api/calls/{call_id}")
def call_details(call_id: int):
    call = get_call(call_id)

    if not call:
        raise HTTPException(status_code=404, detail="Call not found.")

    call["transcript"] = json.loads(call["transcript"])
    call["customer_requirements"] = json.loads(
        call["customer_requirements"]
    )
    call["objections"] = json.loads(call["objections"])
    call["next_steps"] = json.loads(call["next_steps"])

    if call["recording_path"]:
        call["recording_url"] = f"/api/calls/{call_id}/recording"
    else:
        call["recording_url"] = None

    call.pop("recording_path", None)

    return call


@app.get("/api/calls/{call_id}/recording")
def get_recording(call_id: int):
    call = get_call(call_id)

    if not call or not call["recording_path"]:
        raise HTTPException(
            status_code=404,
            detail="Recording not found.",
        )

    path = Path(call["recording_path"]).resolve()

    if path.parent != RECORDINGS_DIR.resolve() or not path.is_file():
        raise HTTPException(
            status_code=404,
            detail="Recording file unavailable.",
        )

    return FileResponse(path, filename=path.name)
