
import json
import os

from groq import Groq

SALES_STATUSES = [
    "Converted",
    "Interested",
    "Follow-up Required",
    "Not Interested",
    "Demo Requested",
    "No Response",
]


def analyze_sales_call(transcript):
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        raise RuntimeError("GROQ_API_KEY is not configured.")

    client = Groq(api_key=api_key)

    conversation = "\n".join(
        f"{item.get('role', 'unknown')}: {item.get('content', '')}"
        for item in transcript
    )

    prompt = f"""
Analyze this SaaS sales call transcript.

Return ONLY valid JSON with these keys:
- summary: concise call summary
- customer_requirements: customer's needs, or "Not identified"
- objections: objections raised, or "None identified"
- next_steps: specific recommended next action
- sales_status: exactly one of {SALES_STATUSES}

Choose "No Response" if the customer did not respond.
Choose "Demo Requested" if the customer explicitly asks for a demo.
Choose "Not Interested" if the customer clearly declines.
Choose "Converted" only if the customer clearly agrees to purchase.
Do not invent details absent from the transcript.

Transcript:
{conversation}
"""

    response = client.chat.completions.create(
        model="openai/gpt-oss-20b",
        messages=[
            {
                "role": "system",
                "content": "You are a precise sales-call analyst. Return valid JSON only.",
            },
            {"role": "user", "content": prompt},
        ],
        max_completion_tokens=1024,
        temperature=0.2,
    )

    content = response.choices[0].message.content or "{}"
    content = content.strip()

    if content.startswith("```"):
        content = content.split("\n", 1)[-1]
        if content.endswith("```"):
            content = content[:-3].strip()

    try:
        result = json.loads(content)
    except json.JSONDecodeError:
        result = {
            "summary": "Call completed. Manual review recommended.",
            "customer_requirements": "Not identified",
            "objections": "Not identified",
            "next_steps": "Review transcript and contact customer if appropriate.",
            "sales_status": "Follow-up Required",
        }

    if result.get("sales_status") not in SALES_STATUSES:
        result["sales_status"] = "Follow-up Required"

    for key in [
        "summary",
        "customer_requirements",
        "objections",
        "next_steps",
    ]:
        result[key] = str(result.get(key) or "Not identified")

    return result
