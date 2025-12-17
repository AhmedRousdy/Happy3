import sqlite3
from config import Config

def upgrade_database():
    db_path = Config.DB_NAME
    print(f"--- Upgrading Database: {db_path} ---")
    
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # 1. Ensure Task Table Columns
    task_columns = [
        ("project", "VARCHAR(100) DEFAULT 'Unknown'"),
        ("tags_json", "TEXT DEFAULT '[]'"),
        ("domain_hint", "VARCHAR(100) DEFAULT 'Unknown'"),
        ("effort_estimate_hours", "FLOAT"),
        ("business_impact", "TEXT"),
        ("reply_acknowledge", "TEXT"),
        ("reply_done", "TEXT"),
        ("reply_delegate", "TEXT"),
        ("action_taken", "VARCHAR(50)"),
        ("received_at", "DATETIME"),
        ("auto_completed_at", "DATETIME"),
        ("completion_evidence", "TEXT"),
        # Executive Triage
        ("triage_category", "VARCHAR(50) DEFAULT 'deep_work'"),
        ("delegated_to", "VARCHAR(200)"),
        ("delegated_at", "DATETIME")
    ]
    
    for col_name, col_type in task_columns:
        try:
            cursor.execute(f"SELECT {col_name} FROM task LIMIT 1")
        except sqlite3.OperationalError:
            print(f"Adding column to 'task': {col_name}...", end=" ")
            try:
                cursor.execute(f"ALTER TABLE task ADD COLUMN {col_name} {col_type}")
                print("Done.")
            except Exception as e:
                print(f"Error adding {col_name}: {e}")

    # 2. Ensure Person Table
    try:
        cursor.execute("SELECT id FROM person LIMIT 1")
    except sqlite3.OperationalError:
        print("Creating 'person' table...", end=" ")
        cursor.execute("""
            CREATE TABLE person (
                id INTEGER PRIMARY KEY,
                email VARCHAR(200) NOT NULL UNIQUE,
                name VARCHAR(200),
                job_title VARCHAR(200),
                department VARCHAR(200),
                office_location VARCHAR(200),
                manager_name VARCHAR(200),
                interaction_count INTEGER DEFAULT 0,
                last_interaction_at DATETIME,
                manual_role VARCHAR(100),
                is_hidden BOOLEAN DEFAULT 0,
                projects_json TEXT DEFAULT '[]'
            )
        """)
        cursor.execute("CREATE INDEX ix_person_email ON person (email)")
        print("Done.")

    conn.commit()
    conn.close()
    print("--- Database Upgrade Complete ---")

if __name__ == "__main__":
    upgrade_database()