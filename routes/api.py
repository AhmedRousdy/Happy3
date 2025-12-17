import os
import glob
import json
import logging
import csv
import io
from flask import make_response
import pytz
from datetime import datetime, timedelta
from flask import Blueprint, jsonify, request
from sqlalchemy import or_
from exchangelib.items import Message

from extensions import db
from models import Task, DailySummary, Person
from utils import get_setting, save_setting, get_json_setting
from config import Config
from services.pipeline_service import run_sync_pipeline, scan_network_period
from services.report_service import generate_weekly_report_logic, process_daily_summary, generate_consolidated_report_logic
from services.ews_service import get_account, fetch_email_content

logger = logging.getLogger(__name__)
api_bp = Blueprint('api', __name__, url_prefix='/api')
pytz_tz = pytz.timezone(getattr(Config, "TIMEZONE", "Asia/Dubai"))

# ... (Previous API routes remain unchanged) ...

# --- HELPER: Auto-Archive ---
def _perform_auto_archive():
    """Archives closed tasks older than Config.ARCHIVE_AFTER_DAYS."""
    try:
        days = getattr(Config, 'ARCHIVE_AFTER_DAYS', 3)
        cutoff_date = datetime.utcnow() - timedelta(days=days)
        
        to_archive = Task.query.filter(
            Task.status == 'closed',
            Task.status_updated_at < cutoff_date
        ).all()
        
        count = 0
        for t in to_archive:
            t.status = 'archived'
            # Clear drafts when archiving
            t.reply_acknowledge = None
            t.reply_done = None
            t.reply_delegate = None
            t.suggested_reply = None
            count += 1
            
        if count > 0:
            db.session.commit()
            logger.info(f"Auto-archived {count} tasks closed before {cutoff_date}")
            
        return count
    except Exception as e:
        logger.error(f"Auto-archive error: {e}")
        db.session.rollback()
        return 0

# --- STATUS & SYNC ---
@api_bp.route('/status', methods=['GET'])
def get_status():
    t = get_setting('last_sync_time')
    return jsonify({"last_sync_time": t})

@api_bp.route('/sync', methods=['POST'])
def trigger_sync():
    now = datetime.now(pytz_tz)
    last_str = get_setting('last_sync_time')
    default_days = getattr(Config, 'DEFAULT_SYNC_DAYS', 3)
    last = datetime.fromisoformat(last_str).astimezone(pytz_tz) if last_str else (now - timedelta(days=default_days))
    
    result = run_sync_pipeline(last, now, save_time=True)
    _perform_auto_archive()
    
    return jsonify(result)

@api_bp.route('/sync/historical', methods=['POST'])
def trigger_historical_sync():
    try:
        data = request.json
        date_str = data.get('date')
        if not date_str: return jsonify({"error": "No date provided."}), 400
        target_date = datetime.strptime(date_str, '%Y-%m-%d').date()
        start_of_day = pytz_tz.localize(datetime(target_date.year, target_date.month, target_date.day, 0, 0, 0))
        end_of_day = pytz_tz.localize(datetime(target_date.year, target_date.month, target_date.day, 23, 59, 59))
        return jsonify(run_sync_pipeline(start_of_day, end_of_day, save_time=False))
    except Exception as e: return jsonify({"error": str(e)}), 500

# --- CIRCLE (PROFESSIONAL NETWORK) ENDPOINTS ---

@api_bp.route('/circle', methods=['GET'])
def get_circle():
    try:
        search = request.args.get('search', '').lower()
        role_filter = request.args.get('role', '')
        
        query = Person.query.filter_by(is_hidden=False)
        
        if search:
            query = query.filter(or_(
                Person.name.ilike(f"%{search}%"),
                Person.email.ilike(f"%{search}%"),
                Person.job_title.ilike(f"%{search}%"),
                Person.department.ilike(f"%{search}%")
            ))
            
        if role_filter:
            if role_filter == 'Unclassified':
                # Filter for NULL or Empty roles
                query = query.filter(or_(Person.manual_role == None, Person.manual_role == ''))
            else:
                query = query.filter(Person.manual_role == role_filter)
            
        # Sort by interaction count (High engagement first)
        contacts = query.order_by(Person.interaction_count.desc()).all()
        return jsonify([p.to_dict() for p in contacts])
    except Exception as e:
        logger.error(f"Circle Fetch Error: {e}")
        return jsonify({"error": str(e)}), 500

@api_bp.route('/circle', methods=['POST'])
def add_contact():
    """Manually add a contact."""
    try:
        data = request.json
        email = data.get('email', '').strip().lower()
        if not email: return jsonify({"error": "Email required"}), 400
        
        if Person.query.filter_by(email=email).first():
            return jsonify({"error": "Contact already exists"}), 400
            
        person = Person(
            email=email,
            name=data.get('name'),
            job_title=data.get('job_title'),
            department=data.get('department'),
            manual_role=data.get('manual_role'),
            interaction_count=0,
            last_interaction_at=datetime.utcnow()
        )
        db.session.add(person)
        db.session.commit()
        return jsonify(person.to_dict())
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": str(e)}), 500

@api_bp.route('/circle/<int:id>', methods=['PUT'])
def update_contact(id):
    """Update contact details."""
    try:
        person = db.session.get(Person, id)
        if not person: return jsonify({"error": "Not found"}), 404
        
        data = request.json
        if 'name' in data: person.name = data['name']
        if 'job_title' in data: person.job_title = data['job_title']
        if 'department' in data: person.department = data['department']
        if 'manual_role' in data: person.manual_role = data['manual_role']
        if 'projects' in data: person.projects_json = json.dumps(data['projects'])
        
        db.session.commit()
        return jsonify(person.to_dict())
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": str(e)}), 500

@api_bp.route('/circle/<int:id>', methods=['DELETE'])
def hide_contact(id):
    """Hide/Remove a contact (Soft Delete)."""
    try:
        person = db.session.get(Person, id)
        if not person: return jsonify({"error": "Not found"}), 404
        
        person.is_hidden = True
        db.session.commit()
        return jsonify({"success": True})
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": str(e)}), 500

@api_bp.route('/circle/export', methods=['GET'])
def export_circle():
    """Export contacts to CSV."""
    try:
        contacts = Person.query.filter_by(is_hidden=False).order_by(Person.interaction_count.desc()).all()
        
        si = io.StringIO()
        cw = csv.writer(si)
        cw.writerow(['Name', 'Email', 'Job Title', 'Department', 'Role', 'Interactions', 'Last Contact', 'Manager'])
        
        for p in contacts:
            cw.writerow([
                p.name, p.email, p.job_title, p.department, 
                p.manual_role, p.interaction_count, 
                p.last_interaction_at, p.manager_name
            ])
            
        output = make_response(si.getvalue())
        output.headers["Content-Disposition"] = "attachment; filename=professional_circle.csv"
        output.headers["Content-type"] = "text/csv"
        return output
    except Exception as e:
        logger.error(f"Export Error: {e}")
        return jsonify({"error": str(e)}), 500

@api_bp.route('/circle/<int:id>/profile', methods=['GET'])
def get_contact_profile(id):
    try:
        person = db.session.get(Person, id)
        if not person: return jsonify({"error": "Not found"}), 404
        
        active_tasks = Task.query.filter(
            Task.sender.ilike(f"%{person.name}%"), 
            or_(Task.status == 'new', Task.status == 'in_progress')
        ).order_by(Task.priority.desc()).limit(5).all()
        
        recent_closed = Task.query.filter(
            Task.sender.ilike(f"%{person.name}%"),
            or_(Task.status == 'closed', Task.status == 'archived')
        ).order_by(Task.status_updated_at.desc()).limit(3).all()
        
        return jsonify({
            "person": person.to_dict(),
            "active_tasks": [t.to_dict() for t in active_tasks],
            "recent_closed": [t.to_dict() for t in recent_closed]
        })
    except Exception as e:
        logger.error(f"Profile Fetch Error: {e}")
        return jsonify({"error": str(e)}), 500

@api_bp.route('/circle/scan', methods=['POST'])
def scan_circle_period():
    try:
        data = request.json
        start_str = data.get('start_date')
        end_str = data.get('end_date')
        
        if not start_str or not end_str:
            return jsonify({"error": "Dates required"}), 400
            
        start_date = datetime.strptime(start_str, '%Y-%m-%d')
        end_date = datetime.strptime(end_str, '%Y-%m-%d')
        
        start_dt = pytz_tz.localize(start_date)
        end_dt = pytz_tz.localize(end_date.replace(hour=23, minute=59, second=59))
        
        result = scan_network_period(start_dt, end_dt)
        return jsonify(result)
    except Exception as e:
        logger.error(f"Scan API Error: {e}")
        return jsonify({"error": str(e)}), 500

# --- TASKS ---
@api_bp.route('/tasks', methods=['GET'])
def get_tasks():
    tasks = Task.query.filter(Task.status != 'archived').order_by(Task.priority.desc(), Task.created_at.desc()).all()
    return jsonify([t.to_dict() for t in tasks])

@api_bp.route('/tasks/archived', methods=['GET'])
def get_archived():
    search = request.args.get('search', '').strip()
    q = Task.query.filter(Task.status == 'archived')
    if search:
        term = f"%{search}%"
        q = q.filter(or_(Task.task_summary.ilike(term), Task.subject.ilike(term), Task.sender.ilike(term)))
    tasks = q.order_by(Task.created_at.desc()).all()
    return jsonify([t.to_dict() for t in tasks])

@api_bp.route('/tasks/<int:task_id>', methods=['PUT'])
def update_task(task_id):
    try:
        task = db.session.get(Task, task_id)
        if not task: return jsonify({"error": "Not found"}), 404
        data = request.json
        if 'status' in data: 
            new_status = data['status']
            task.status = new_status
            task.status_updated_at = datetime.utcnow()
            
            if new_status == 'closed' and not task.action_taken:
                 task.action_taken = 'closed_no_action'

            if new_status == 'archived':
                task.reply_acknowledge = None
                task.reply_done = None
                task.reply_delegate = None
                task.suggested_reply = None

        if 'priority' in data: task.priority = data['priority']
        if 'project' in data: task.project = data['project']
        if 'domain_hint' in data: task.domain_hint = data['domain_hint']
        if 'effort_estimate_hours' in data: task.effort_estimate_hours = data['effort_estimate_hours']
        if 'business_impact' in data: task.business_impact = data['business_impact']
        if 'tags' in data: task.tags_json = json.dumps(data['tags'])
        
        if 'triage_category' in data: task.triage_category = data['triage_category']
        if 'delegated_to' in data: 
            task.delegated_to = data['delegated_to']
            task.delegated_at = datetime.utcnow()
            
        db.session.commit()
        return jsonify(task.to_dict())
    except Exception as e: db.session.rollback(); return jsonify({"error": str(e)}), 500

@api_bp.route('/tasks/<int:task_id>', methods=['DELETE'])
def delete_task(task_id):
    try:
        task = db.session.get(Task, task_id)
        if not task: return jsonify({"error": "Not found"}), 404
        db.session.delete(task); db.session.commit()
        return jsonify({"success": True})
    except Exception as e: db.session.rollback(); return jsonify({"error": str(e)}), 500

@api_bp.route('/tasks/archive/run', methods=['POST'])
def run_archive():
    try:
        count = _perform_auto_archive()
        return jsonify({"success": True, "archived_count": count})
    except Exception as e: return jsonify({"error": str(e)}), 500

@api_bp.route('/tasks/<int:task_id>/reply', methods=['POST'])
def send_reply(task_id):
    try:
        data = request.json
        body = data.get('reply_body')
        reply_type = data.get('reply_type') 
        
        task = db.session.get(Task, task_id)
        if not task or not task.ews_item_id: return jsonify({"error": "Task invalid"}), 404
        
        account = get_account()
        if not account: return jsonify({"error": "EWS Disconnected"}), 503
        
        items = list(account.fetch(ids=[(task.ews_item_id, task.ews_change_key)]))
        if not items: return jsonify({"error": "Original email missing"}), 404
        
        original = items[0]
        if isinstance(original, Exception): raise original
        
        reply = original.create_reply(subject=f"RE: {original.subject}", body=body)
        reply.send() 
        
        if reply_type == 'done':
            task.status = 'closed'
            task.action_taken = 'done'
        elif reply_type == 'acknowledge':
            task.status = 'in_progress'
            task.action_taken = 'acknowledge'
        elif reply_type == 'delegate':
            task.triage_category = 'waiting_for'
            task.status = 'in_progress'
            task.action_taken = 'delegate'
        else:
            if task.status == 'new':
                task.status = 'in_progress'
            
        task.status_updated_at = datetime.utcnow()
        db.session.commit()
        return jsonify(task.to_dict())
    except Exception as e: 
        logger.error(f"Reply error: {e}")
        return jsonify({"error": str(e)}), 500

@api_bp.route('/tasks/<int:task_id>/email', methods=['GET'])
def get_original_email(task_id):
    try:
        task = db.session.get(Task, task_id)
        if not task or not task.ews_item_id:
            return jsonify({"error": "Task or Email ID missing"}), 404
            
        email_data = fetch_email_content(task.ews_item_id, task.ews_change_key)
        
        if not email_data:
            return jsonify({"error": "Original email no longer available in mailbox"}), 404
            
        return jsonify(email_data)
        
    except Exception as e:
        logger.error(f"Error fetching email for task {task_id}: {e}")
        return jsonify({"error": "Failed to fetch email from Exchange"}), 500

# --- SUMMARIES ---
@api_bp.route('/summaries', methods=['GET'])
def get_summaries():
    sums = DailySummary.query.order_by(DailySummary.summary_date.desc()).all()
    return jsonify([s.to_dict() for s in sums])

@api_bp.route('/summaries/generate/<int:id>', methods=['POST'])
def trigger_summary_gen(id):
    try:
        process_daily_summary(id)
        db.session.commit(); s = db.session.get(DailySummary, id)
        if s.status == 'generating': s.status = 'failed'; s.content = "Timed out."; db.session.commit()
        return jsonify(s.to_dict())
    except Exception as e: return jsonify({"error": str(e)}), 500

@api_bp.route('/summaries/regenerate/<int:id>', methods=['POST'])
def trigger_summary_regen(id):
    return trigger_summary_gen(id) # Same logic

# --- REPORTS ---
@api_bp.route('/reports/list', methods=['GET'])
def list_reports():
    try:
        files = glob.glob(os.path.join(Config.REPORTS_PATH, "*.html"))
        files.sort(key=os.path.getctime, reverse=True)
        return jsonify([{"filename": os.path.basename(f), "created": datetime.fromtimestamp(os.path.getctime(f)).strftime('%Y-%m-%d %H:%M')} for f in files])
    except Exception as e: return jsonify({"error": str(e)}), 500

@api_bp.route('/reports/custom', methods=['POST'])
def generate_custom_report():
    try:
        data = request.json
        path, fname, _ = generate_weekly_report_logic(datetime.strptime(data['start_date'], '%Y-%m-%d').date(), datetime.strptime(data['end_date'], '%Y-%m-%d').date(), "Custom Report")
        if path: return jsonify({"success": True, "url": f"/reports/{fname}"})
        return jsonify({"error": "Failed"}), 500
    except Exception as e: return jsonify({"error": str(e)}), 500

# --- NEW: Consolidated Report Endpoint ---
@api_bp.route('/reports/consolidated', methods=['POST'])
def generate_consolidated_report():
    try:
        data = request.json
        start_str = data.get('start_date')
        end_str = data.get('end_date')
        
        if not start_str or not end_str:
            return jsonify({"error": "Start and End dates are required"}), 400
            
        start_date = datetime.strptime(start_str, '%Y-%m-%d').date()
        end_date = datetime.strptime(end_str, '%Y-%m-%d').date()
        
        path, fname = generate_consolidated_report_logic(start_date, end_date)
        
        if path:
            return jsonify({"success": True, "url": f"/reports/{fname}"})
        else:
            return jsonify({"error": "Failed to generate report"}), 500
            
    except Exception as e:
        logger.error(f"Consolidated Report API Error: {e}")
        return jsonify({"error": str(e)}), 500

# --- SETTINGS (UPDATED) ---
@api_bp.route('/settings', methods=['GET'])
def get_settings():
    """Returns general settings + classification lists + SLA config."""
    model = get_setting('ollama_model') or Config.OLLAMA_MODEL
    sla_days = getattr(Config, 'SLA_RESPONSE_DAYS', 4) # Fetch backend SLA config
    
    # Fetch lists (or defaults if missing)
    projects = get_json_setting('classification_projects', Config.DEFAULT_PROJECTS)
    tags = get_json_setting('classification_tags', Config.DEFAULT_TAGS)
    domains = get_json_setting('classification_domains', Config.DEFAULT_DOMAINS)
    
    return jsonify({
        'ollama_model': model,
        'projects': projects,
        'tags': tags,
        'domains': domains,
        'sla_days': sla_days # Include in response
    })

@api_bp.route('/settings', methods=['POST'])
def update_settings():
    """Updates general settings + classification lists."""
    try:
        data = request.json
        if 'ollama_model' in data:
            save_setting('ollama_model', data['ollama_model'])
            
        # Save Lists as JSON strings
        if 'projects' in data:
            save_setting('classification_projects', json.dumps(data['projects']))
        if 'tags' in data:
            save_setting('classification_tags', json.dumps(data['tags']))
        if 'domains' in data:
            save_setting('classification_domains', json.dumps(data['domains']))
            
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500