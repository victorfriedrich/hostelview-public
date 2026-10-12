"""
Environment configuration, read once. Values come from the process environment,
or from backend/.env when running locally (see backend/.env.example).
"""
import os

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"))

DATABASE_URL = os.getenv("DATABASE_URL", "")
DB_POOL_SIZE = int(os.getenv("DB_POOL_SIZE", "5"))

# OpenRouter: Jev ratings.
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")

# Browser origins allowed to call the API (comma-separated); "*" allows any.
CORS_ORIGINS = [o.strip() for o in os.getenv("CORS_ORIGINS", "*").split(",") if o.strip()]
