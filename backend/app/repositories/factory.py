from app.config import Settings, is_remote_database
from app.errors import DatabaseUnavailable
from app.repositories.sqlite import SQLiteCallRepository
from app.repositories.supabase import SupabaseCallRepository


def create_repository(settings: Settings):
    if is_remote_database(settings):
        if not settings.supabase_url or not settings.supabase_service_role_key:
            raise DatabaseUnavailable("Configure both SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, or leave both blank for local SQLite.")
        return SupabaseCallRepository(settings.supabase_url, settings.supabase_service_role_key)
    return SQLiteCallRepository(settings.database_path)
