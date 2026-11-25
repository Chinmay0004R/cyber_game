import os

MIN_PLAYERS = 2
MAX_PLAYERS = 15
RATE_LIMIT_SECONDS = 3

ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "admin123")
SECRET_KEY = os.environ.get("SECRET_KEY", "cybur-hunt-dev-secret-key")

