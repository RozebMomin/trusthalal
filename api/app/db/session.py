from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.config import settings

if not settings.DATABASE_URL:
    raise RuntimeError("DATABASE_URL is not set")

engine = create_engine(
    settings.DATABASE_URL,
    pool_pre_ping=True,
    # Cap connections below Supabase's session-mode pooler limit (15) so a
    # burst — several requests plus the photo-publish background task — can't
    # exhaust it and 500 the auth path. Default is 5 + 10 = 15, which sat
    # exactly on the ceiling; this caps at DB_POOL_SIZE + DB_MAX_OVERFLOW.
    pool_size=settings.DB_POOL_SIZE,
    max_overflow=settings.DB_MAX_OVERFLOW,
    pool_recycle=settings.DB_POOL_RECYCLE,
    pool_timeout=settings.DB_POOL_TIMEOUT,
)

SessionLocal = sessionmaker(
    bind=engine,
    autoflush=False,
    autocommit=False,
)