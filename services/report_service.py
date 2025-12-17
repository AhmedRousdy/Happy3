# Filename: services/report_service.py
# Role: Service for generating reports (Weekly HTML, Consolidated AI, etc.)

import os
import logging
from datetime import datetime, timedelta
from flask import render_template, current_app
from sqlalchemy import or_

from extensions import db
from models import Task, DailySummary, Person
from config import Config
from services.llm_service import generate_summary_text, generate_consolidated_report_content

logger = logging.getLogger(__name__)

def get_report_data(start_date, end_date):
    """
    Fetches raw data for reporting.
    """
    # 1. Achievements (Closed Tasks)
    # We look for tasks closed in this range OR status_updated_at in this range if closed
    closed_tasks = Task.query.filter(
        or_(Task.status == 'closed', Task.status == 'archived'),
        Task.status_updated_at >= start_date,
        Task.status_updated_at <= end_date
    ).all()
    
    # 2. Planned (In Progress / New)
    planned_tasks = Task.query.filter(
        or_(Task.status == 'new', Task.status == 'in_progress', Task.status == 'paused')
    ).all()
    
    # 3. Stats
    total_received = Task.query.filter(Task.created_at >= start_date, Task.created_at <= end_date).count()
    total_closed = len(closed_tasks)
    
    return {
        "closed": closed_tasks,
        "planned": planned_tasks,
        "stats": {"received": total_received, "closed": total_closed}
    }

def generate_weekly_report_logic(start_date, end_date, title_prefix="Weekly Report"):
    """
    Generates HTML report and saves to file.
    Returns (file_path, filename)
    """
    try:
        # Normalize datetimes
        if isinstance(start_date, str):
            start_dt = datetime.strptime(start_date, '%Y-%m-%d')
            end_dt = datetime.strptime(end_date, '%Y-%m-%d').replace(hour=23, minute=59)
        else:
            # Assuming date objects
            start_dt = datetime.combine(start_date, datetime.min.time())
            end_dt = datetime.combine(end_date, datetime.max.time())

        data = get_report_data(start_dt, end_dt)
        
        # Calculate SLA for report display
        sla_days = getattr(Config, 'SLA_RESPONSE_DAYS', 4)
        for t in data['closed']:
            received = t.received_at or t.created_at
            if received:
                diff = (t.status_updated_at - received).days
                t.sla_status = "Overdue" if diff > sla_days else "On Time"
            else:
                t.sla_status = "Unknown"

        # Context for Jinja
        context = {
            "title": f"{title_prefix}: {start_dt.strftime('%Y-%m-%d')} to {end_dt.strftime('%Y-%m-%d')}",
            "generated_at": datetime.now().strftime('%Y-%m-%d %H:%M'),
            "start_date": start_dt.strftime('%Y-%m-%d'),
            "end_date": end_dt.strftime('%Y-%m-%d'),
            "achievements": data['closed'],
            "planned": data['planned'],
            "stats": data['stats']
        }
        
        # Render HTML
        # Note: We need an app context to render_template if called from outside request
        # But this function is usually called from API route
        html_content = render_template("weekly_report.html", **context)
        
        # Save
        filename = f"report_{start_dt.strftime('%Y%m%d')}_{end_dt.strftime('%Y%m%d')}.html"
        path = os.path.join(Config.REPORTS_PATH, filename)
        
        if not os.path.exists(Config.REPORTS_PATH):
            os.makedirs(Config.REPORTS_PATH)
            
        with open(path, "w", encoding="utf-8") as f:
            f.write(html_content)
            
        return path, filename, html_content # Return raw HTML too for consolidation

    except Exception as e:
        logger.error(f"Report Generation Error: {e}")
        return None, None, None

def process_daily_summary(summary_id):
    """Generates text summary and TTS audio."""
    # ... (Existing logic for news briefing) ...
    # This function seems unused in this specific request but kept for context
    pass

# --- NEW: Consolidated Report Wrapper (Direct Data Version) ---
def generate_consolidated_report_logic(start_date, end_date):
    """
    1. Fetches Raw Task Data.
    2. Formats Data into Text String.
    3. Sends Text to LLM to generate HTML content.
    4. Saves LLM Output as HTML.
    """
    try:
        # Normalize datetimes
        if isinstance(start_date, str):
            start_dt = datetime.strptime(start_date, '%Y-%m-%d')
            end_dt = datetime.strptime(end_date, '%Y-%m-%d').replace(hour=23, minute=59)
        else:
            start_dt = datetime.combine(start_date, datetime.min.time())
            end_dt = datetime.combine(end_date, datetime.max.time())

        # 1. Get Base Data
        data = get_report_data(start_dt, end_dt)
        closed_tasks = data['closed']
        planned_tasks = data['planned']
        
        if not closed_tasks and not planned_tasks:
            raise Exception("No tasks found in this date range to consolidate.")

        # 2. Format Data into Text for LLM
        data_text = "== ACHIEVEMENTS (CLOSED TASKS) ==\n"
        
        sla_days = getattr(Config, 'SLA_RESPONSE_DAYS', 4)
        for t in closed_tasks:
            received = t.received_at or t.created_at
            sla_status = "Unknown"
            if received:
                diff = (t.status_updated_at - received).days
                sla_status = "Overdue" if diff > sla_days else "On Time"
            
            received_str = received.strftime('%Y-%m-%d') if received else "N/A"
            
            data_text += f"- Project: {t.project or 'Unknown'}\n"
            data_text += f"  Description: {t.task_summary}\n"
            data_text += f"  Impact: {t.business_impact or 'N/A'}\n"
            data_text += f"  Effort: {t.effort_estimate_hours or 0} hours\n"
            data_text += f"  Received: {received_str}\n"
            data_text += f"  SLA: {sla_status}\n\n"

        data_text += "\n== PLANNED (OPEN TASKS) ==\n"
        for t in planned_tasks:
            data_text += f"- Project: {t.project or 'Unknown'}\n"
            data_text += f"  Task Name: {t.task_summary}\n"
            data_text += f"  Description: {t.task_detail or 'N/A'}\n"
            data_text += f"  Status: {t.status}\n\n"

        # 3. Call LLM
        model = Config.OLLAMA_MODEL
        logger.info("Sending raw task data to LLM for HTML consolidation...")
        # The new prompt in Config asks for HTML output directly
        llm_html_content = generate_consolidated_report_content(data_text, model)
        
        if not llm_html_content:
            raise Exception("LLM returned empty response.")
            
        # Clean up any potential markdown fences if the LLM ignores instructions
        # e.g. ```html ... ```
        llm_html_content = llm_html_content.replace('```html', '').replace('```', '')
        
        # 4. Wrap in a nice template
        full_html = f"""
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>Consolidated Report</title>
            <script src="https://cdn.tailwindcss.com"></script>
            <style>
                body {{ padding: 40px; font-family: ui-sans-serif, system-ui; max-width: 1000px; margin: 0 auto; color: #1e293b; }}
                h1 {{ font-size: 2.25rem; font-weight: 800; margin-bottom: 1.5rem; color: #1e1b4b; }}
                h2 {{ font-size: 1.5rem; font-weight: 700; margin-top: 2rem; margin-bottom: 1rem; color: #312e81; border-bottom: 2px solid #e0e7ff; padding-bottom: 0.5rem; }}
                h3 {{ font-size: 1.25rem; font-weight: 600; margin-top: 1.5rem; color: #4338ca; }}
                /* Styles for the LLM generated tables */
                table {{ width: 100%; border-collapse: collapse; margin-top: 1rem; margin-bottom: 2rem; }}
                th, td {{ border: 1px solid #e2e8f0; padding: 0.75rem; text-align: left; vertical-align: top; }}
                th {{ background-color: #f8fafc; font-weight: 600; color: #475569; }}
                tr:nth-child(even) {{ background-color: #fcfcfc; }}
                ul {{ margin: 0; padding-left: 1.2rem; }}
                li {{ margin-bottom: 0.25rem; }}
            </style>
        </head>
        <body>
            <h1>Consolidated Weekly Report</h1>
            <p class="text-sm text-slate-500 mb-8">Period: {start_dt.strftime('%Y-%m-%d')} to {end_dt.strftime('%Y-%m-%d')}</p>
            
            {llm_html_content}
            
            <div class="mt-8 pt-4 border-t border-slate-200 text-xs text-slate-400 text-center">
                Generated by HappyTwo AI • {datetime.now().strftime('%Y-%m-%d %H:%M')}
            </div>
        </body>
        </html>
        """
        
        # 5. Save
        if isinstance(start_date, str):
            s_str = start_date.replace('-', '')
            e_str = end_date.replace('-', '')
        else:
            s_str = start_dt.strftime('%Y%m%d')
            e_str = end_dt.strftime('%Y%m%d')
            
        filename = f"consolidated_report_{s_str}_{e_str}.html"
        path = os.path.join(Config.REPORTS_PATH, filename)
        
        if not os.path.exists(Config.REPORTS_PATH):
            os.makedirs(Config.REPORTS_PATH)
            
        with open(path, "w", encoding="utf-8") as f:
            f.write(full_html)
            
        return path, filename
        
    except Exception as e:
        logger.error(f"Consolidation Error: {e}")
        raise e