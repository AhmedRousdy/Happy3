import json
import logging
import pytz
import re
from datetime import datetime
from sqlalchemy.exc import IntegrityError
from sqlalchemy import or_

from extensions import db
from config import Config
from models import Task, DailySummary, Person
from utils import save_setting, clean_email_body, extract_snippet, get_priority_from_text, is_email_junk_by_regex
from services.ews_service import fetch_emails, fetch_sent_emails, get_gal_details
from services.llm_service import run_triage_model, extract_task_json

logger = logging.getLogger(__name__)

# Regex for completion keywords
COMPLETION_REGEX = re.compile(r"(?i)\b(done|completed|resolved|fixed|handled|finished|closed)\b")

def update_professional_circle(email_item, project_name=None):
    """Updates Person registry from email participants."""
    try:
        contacts_to_process = []
        if email_item.sender and email_item.sender.email_address:
            contacts_to_process.append({
                'email': email_item.sender.email_address.lower(),
                'name': email_item.sender.name
            })
            
        for contact in contacts_to_process:
            email = contact['email']
            name = contact['name']
            my_email = Config.MY_PRIMARY_EMAIL_FROM_ENV.lower() if Config.MY_PRIMARY_EMAIL_FROM_ENV else ""
            if email == my_email: continue

            person = Person.query.filter_by(email=email).first()
            if not person:
                logger.info(f"Discovered new contact: {email}")
                person = Person(
                    email=email, name=name, interaction_count=1, last_interaction_at=datetime.utcnow()
                )
                gal_data = get_gal_details(email)
                if gal_data:
                    person.job_title = gal_data.get('job_title')
                    person.department = gal_data.get('department')
                    person.office_location = gal_data.get('office')
                    person.manager_name = gal_data.get('manager')
                    if gal_data.get('name'): person.name = gal_data.get('name') 
                db.session.add(person)
            else:
                person.interaction_count += 1
                person.last_interaction_at = datetime.utcnow()
                if not person.name and name: person.name = name
            
            if project_name and project_name != 'Unknown':
                try:
                    current_projects = json.loads(person.projects_json or "[]")
                    normalized_projects = []
                    project_exists = False
                    for p in current_projects:
                        if isinstance(p, str):
                            if p == project_name: project_exists = True
                            normalized_projects.append({'name': p, 'role': 'Contributor'})
                        elif isinstance(p, dict):
                            if p.get('name') == project_name: project_exists = True
                            normalized_projects.append(p)
                    if not project_exists:
                        normalized_projects.append({'name': project_name, 'role': 'Contributor'}) 
                        person.projects_json = json.dumps(normalized_projects)
                except Exception as e: logger.error(f"Error updating projects: {e}")
            
            db.session.commit()
    except Exception as e:
        logger.error(f"Professional Circle Update Error: {e}")
        db.session.rollback()

def process_sent_items_for_completion(start_time, end_time):
    """
    Scans Sent Items for replies to open tasks.
    If a reply is found with keywords like 'Done' or 'Resolved', mark task as completed.
    """
    try:
        # 1. Get Open Tasks
        open_tasks = Task.query.filter(or_(Task.status == 'new', Task.status == 'in_progress')).all()
        if not open_tasks: return 0
        
        # Create map of Message-ID -> Task
        task_map = {t.email_message_id: t for t in open_tasks if t.email_message_id}
        
        # 2. Fetch Sent Items
        sent_emails = fetch_sent_emails(start_time, end_time)
        completed_count = 0
        
        for email in sent_emails:
            if email.in_reply_to and email.in_reply_to in task_map:
                task = task_map[email.in_reply_to]
                body_text = email.text_body or email.body or ""
                
                if COMPLETION_REGEX.search(body_text):
                    logger.info(f"Auto-completing Task {task.id} based on reply '{email.subject}'")
                    task.status = 'closed'
                    task.action_taken = 'auto_completed'
                    task.auto_completed_at = datetime.utcnow()
                    snippet = (body_text[:100] + '...') if len(body_text) > 100 else body_text
                    task.completion_evidence = f"Replied via Outlook on {email.datetime_sent.strftime('%Y-%m-%d %H:%M')}: \"{snippet}\""
                    completed_count += 1
        
        if completed_count > 0:
            db.session.commit()
            
        return completed_count

    except Exception as e:
        logger.error(f"Auto-completion Scan Error: {e}")
        return 0

def scan_network_period(start_time, end_time):
    try:
        logger.info(f"Starting Network Scan from {start_time} to {end_time}")
        emails = fetch_emails(start_time, end_time)
        count = 0
        for email in emails:
            update_professional_circle(email)
            count += 1
        return {"success": True, "scanned": count}
    except Exception as e:
        logger.error(f"Network Scan Error: {e}", exc_info=True)
        return {"success": False, "error": str(e)}

def process_single_email(email_item, triage_model, smart_model):
    """3-Layer analysis for one email."""
    
    update_professional_circle(email_item)

    if db.session.query(Task.id).filter_by(email_message_id=email_item.message_id).first():
        logger.debug(f"Skipping processed email: {email_item.message_id}")
        return None 

    raw_body = email_item.text_body if email_item.text_body else (email_item.body or "")
    cleaned_body = clean_email_body(raw_body)
    
    content = f"Subject: {email_item.subject}\nBody: {cleaned_body}"
    sender = email_item.sender.name if email_item.sender else "Unknown"

    if is_email_junk_by_regex(content): 
        logger.info(f"Junk Regex detected. Skipping {email_item.subject}")
        return None

    # --- PHASE 2: PREFIX CHECK ---
    has_fyi = Config.SUBJECT_PREFIXES['FYI'].search(email_item.subject)
    has_approve = Config.SUBJECT_PREFIXES['APPROVE'].search(email_item.subject)
    
    classification = 'INFO'
    if has_fyi:
        logger.info(f"Prefix [FYI] detected. Forcing classification to INFO.")
        classification = 'INFO'
    elif has_approve:
        logger.info(f"Prefix [APPROVE] detected. Forcing classification to ACTION.")
        classification = 'ACTION'
    else:
        classification = run_triage_model(content, triage_model)
    
    logger.info(f"Email '{email_item.subject}' classified as: {classification}")

    if classification == 'ACTION':
        data = extract_task_json(content, smart_model) or {}
        is_task = data.get('is_task') == 'YES'
        score = data.get('task_confidence_score', 0)
        
        if is_task and score >= 30:
            logger.info("Task extracted successfully.")
            reply_opts = data.get('reply_options', {})
            extracted_project = data.get('project', 'Unknown')
            
            # --- TRIAGE LOGIC ---
            triage_cat = data.get('triage_category', 'deep_work') 
            delegated_to = data.get('delegated_to_hint')
            
            if has_approve:
                triage_cat = 'quick_action'
            
            if not triage_cat or triage_cat not in ['quick_action', 'deep_work', 'waiting_for']:
                minutes = data.get('effort_estimate_minutes', 30)
                if minutes < 15: triage_cat = 'quick_action'
                else: triage_cat = 'deep_work'
            
            # --- TIMEZONE FIX ---
            received_at_utc = None
            if email_item.datetime_received:
                try:
                    # Convert EWSDateTime to a naive UTC datetime object safely
                    dt = email_item.datetime_received
                    if hasattr(dt, 'astimezone'):
                        # Use UTC timezone from datetime module for standard conversion
                        # This avoids the strict type check from exchangelib
                        from datetime import timezone
                        received_at_utc = dt.astimezone(timezone.utc).replace(tzinfo=None)
                    else:
                        received_at_utc = dt.replace(tzinfo=None)
                except Exception as e:
                    logger.warning(f"Error converting received time: {e}")
                    received_at_utc = datetime.utcnow()

            update_professional_circle(email_item, project_name=extracted_project)

            effort_hrs = None
            if data.get('effort_estimate_minutes'):
                effort_hrs = data.get('effort_estimate_minutes') / 60.0

            return {
                "type": "task",
                "data": {
                    "email_message_id": email_item.message_id,
                    "subject": email_item.subject,
                    "sender": sender,
                    "task_summary": data.get('task_summary', email_item.subject),
                    "task_detail": data.get('task_detail', extract_snippet(cleaned_body)),
                    "required_action": data.get('required_action'),
                    "reply_acknowledge": reply_opts.get('acknowledge'),
                    "reply_done": reply_opts.get('done'),
                    "reply_delegate": reply_opts.get('delegate'),
                    "suggested_reply": None, 
                    "received_at": received_at_utc,
                    "ews_item_id": email_item.id,
                    "ews_change_key": email_item.changekey,
                    "priority": get_priority_from_text(content),
                    "project": extracted_project,
                    "tags_json": json.dumps(data.get('tags', [])),
                    "domain_hint": data.get('domain_hint'),
                    "effort_estimate_hours": effort_hrs,
                    "business_impact": data.get('business_impact'),
                    "triage_category": triage_cat,
                    "delegated_to": delegated_to
                }
            }
        else:
            update_professional_circle(email_item)
            return {
                "type": "news",
                "data": {
                    "sender": sender,
                    "subject": email_item.subject,
                    "snippet": extract_snippet(cleaned_body)
                }
            }
            
    elif classification == 'INFO':
        update_professional_circle(email_item)
        return {
            "type": "news",
            "data": {
                "sender": sender,
                "subject": email_item.subject,
                "snippet": extract_snippet(cleaned_body)
            }
        }
    
    return None

def run_sync_pipeline(start_time, end_time, save_time=True):
    """Main Orchestrator."""
    try:
        logger.info(f"Starting Sync Pipeline from {start_time} to {end_time}")
        emails = fetch_emails(start_time, end_time)
        
        completions = process_sent_items_for_completion(start_time, end_time)
        if completions > 0:
            logger.info(f"Auto-completed {completions} tasks based on Outlook replies.")

        if not emails:
            if save_time: save_setting('last_sync_time', end_time.isoformat())
            return {"success": True, "analyzed": 0, "created": 0, "auto_completed": completions}

        triage_model = getattr(Config, 'OLLAMA_TRIAGE_MODEL')
        smart_model = getattr(Config, 'OLLAMA_MODEL') 

        tasks_to_add = []
        snippets_to_add = []

        for email in emails:
            res = process_single_email(email, triage_model, smart_model)
            if res:
                if res['type'] == 'task': tasks_to_add.append(Task(**res['data']))
                elif res['type'] == 'news': snippets_to_add.append(res['data'])

        for t in tasks_to_add:
            try: db.session.add(t); db.session.commit()
            except IntegrityError: db.session.rollback()

        if snippets_to_add:
            summary_date = start_time.date()
            summary = db.session.query(DailySummary).filter_by(summary_date=summary_date).first()
            if not summary:
                summary = DailySummary(summary_date=summary_date, raw_snippets="[]")
                db.session.add(summary)
            
            current = json.loads(summary.raw_snippets or "[]")
            current.extend(snippets_to_add)
            summary.raw_snippets = json.dumps(current)
            db.session.commit()

        if save_time: save_setting('last_sync_time', end_time.isoformat())

        return {"success": True, "analyzed": len(emails), "created": len(tasks_to_add), "auto_completed": completions}

    except Exception as e:
        logger.error(f"Pipeline Error: {e}", exc_info=True)
        return {"success": False, "error": str(e)}