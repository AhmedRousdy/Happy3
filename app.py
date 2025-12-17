import os
import logging
from flask import Flask
from apscheduler.schedulers.background import BackgroundScheduler
import pytz

from config import Config
from extensions import db, migrate
from routes.views import view_bp
from routes.api import api_bp
from services.ews_service import init_ews
from services.llm_service import check_and_pull_model
from fix_db import upgrade_database
from services.pipeline_service import scan_network_period 

# Ensure dirs
os.makedirs(Config.BRIEFING_AUDIO_PATH, exist_ok=True)
os.makedirs(Config.REPORTS_PATH, exist_ok=True)

app = Flask(__name__)
app.config.from_object(Config)

# Init Extensions
db.init_app(app)
migrate.init_app(app, db)

# Register Blueprints
app.register_blueprint(view_bp)
app.register_blueprint(api_bp)

# Scheduler
def start_scheduler():
    scheduler = BackgroundScheduler(timezone=Config.TIMEZONE)
    # Import jobs inside function to ensure app context if needed
    from services.report_service import generate_weekly_report_logic
    
    # Weekly Network Scan (e.g., every Friday night)
    def scheduled_network_scan():
        with app.app_context():
            # Calculate last 7 days
            end_date = datetime.now(pytz.timezone(Config.TIMEZONE))
            start_date = end_date - timedelta(days=7)
            scan_network_period(start_date, end_date) 
            
    # scheduler.add_job(scheduled_network_scan, 'cron', day_of_week='fri', hour=22)
    scheduler.start()

if __name__ == '__main__':
    with app.app_context():
        # 1. Run DB Upgrade
        upgrade_database()
        
        # 2. Create tables
        db.create_all()
        
        # 3. Init Services
        init_ews()
        check_and_pull_model(Config.OLLAMA_MODEL)
        start_scheduler()

    app.run(
        host=os.environ.get('FLASK_HOST', '127.0.0.1'),
        port=int(os.environ.get('FLASK_PORT', 5001)),
        debug=True,
        use_reloader=False
    )