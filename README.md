# FlowDesk AI — Voice Sales Bot

An AI-powered sales assistant that engages with potential customers, asks about their workflow, and helps identify productivity challenges through conversational interactions.

## Overview

FlowDesk AI demonstrates how an AI sales assistant can initiate customer conversations, understand business requirements, and respond to customer questions. The application combines a web frontend, an API backend, and an AI service to provide a conversational sales experience.

## Features

- **AI-powered conversations:** Generate contextual responses to customer messages.
- **Customer discovery:** Ask questions to understand existing workflows and business challenges.
- **Sales assistance:** Help explore customer pain points, such as missed deadlines, duplicated work, and limited task visibility.
- **Call-related data storage:** Use SQLite to store call-related records.
- **Web interface:** Interact with the assistant through a React-based frontend.
- **Backend API:** Process application requests through FastAPI.

## Tech Stack

| Component | Technology |
|---|---|
| Frontend | React |
| Backend | Python, FastAPI |
| AI integration | Configured AI service |
| Database | SQLite |
| Frontend deployment | Vercel |
| Backend deployment | Render |

## Architecture

1. The customer interacts with FlowDesk AI through the web interface.
2. The frontend sends requests to the backend API.
3. The backend processes requests and integrates with the configured AI service.
4. The assistant generates a conversational response.
5. Call-related information can be stored in the SQLite database, depending on the workflow.

## Live Demo

- **Frontend:** https://sanskar-ai-voice-sales-bot.vercel.app/
- **Backend:** https://sanskar-ai-voice-sales-bot.onrender.com

## Run Locally

### Prerequisites

- Python 3.10 or a compatible version supported by the project dependencies
- Node.js and npm
- An API key for the configured AI provider

### 1. Clone the repository

```bash
git clone https://github.com/AdhravRai/sanskar-ai-voice-sales-bot.git
cd sanskar-ai-voice-sales-bot
```

### 2. Configure the backend

```bash
cd backend
python -m venv .venv
```

Activate the virtual environment.

**Windows:**
```powershell
.venv\Scripts\activate
```

**macOS/Linux:**
```bash
source .venv/bin/activate
```

Install the dependencies using the dependency file provided in the backend directory. For example, if the project contains `requirements.txt`:

```bash
pip install -r requirements.txt
```

Configure the required environment variables using the project's environment configuration. Do not commit API keys or secrets to GitHub.

Start the backend:

```bash
uvicorn main:app --reload
```

The backend should be available at:

http://127.0.0.1:8000

API documentation, when enabled by FastAPI, is available at:

http://127.0.0.1:8000/docs

### 3. Configure the frontend

Open a separate terminal and navigate to the frontend directory:

```bash
cd frontend
npm install
```

Configure the frontend API URL to point to the local backend, using the environment variable expected by the project:

```env
VITE_API_URL=http://127.0.0.1:8000
```

Start the frontend:

```bash
npm run dev
```

Open the local URL printed by Vite in your terminal.

> Adjust directory names and environment variables if your repository uses a different structure.

## Environment Configuration

Set the API key required by the configured AI provider and any other environment variables required by the backend. Refer to the project's environment example file or configuration module for the exact variable names.

Never expose credentials in source code, screenshots, or public repositories.

## Future Improvements

- Improve sales conversation flows and customer qualification.
- Add stronger error handling and conversation recovery.
- Improve call history and post-call analysis.
- Add automated tests for the frontend and backend.
- Enhance monitoring, logging, and production reliability.

## Author

Developed as part of the Sankar Group AI Voice Sales Bot assignment.
