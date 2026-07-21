from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from pathlib import Path

# Load env variables from the parent .env file
ENV_PATH = Path(__file__).parent.parent / ".env"
load_dotenv(ENV_PATH)

from app.routers import telemetry, alerts, settings, sos
import app.auth  # noqa: F401 — registers auth module on startup

def create_app() -> FastAPI:
    app = FastAPI(
        title="MediSyncAI Telemetry System",
        description="Live tracking backend for the Mobile Diagnostic Unit.",
        version="1.0.0"
    )

    app.add_middleware(
        CORSMiddleware,
        # Restrict to known origins. Add your deployed frontend URL here in production.
        allow_origins=[
            "http://localhost:5173",   # Vite dev server
            "http://localhost:4173",   # Vite preview
            "http://127.0.0.1:5173",
            "https://eth-apex-2026.vercel.app",
        ],
        allow_credentials=True,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type"],
    )

    # Register Routers
    app.include_router(telemetry.router)
    app.include_router(alerts.router)
    app.include_router(settings.router)
    app.include_router(sos.router)

    @app.get("/")
    def read_root():
        return {"status": "ok", "message": "Ambulance Enterprise Telemetry Engine Running"}

    return app

app = create_app()