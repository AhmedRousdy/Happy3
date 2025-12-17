from datetime import datetime, date
import json
from extensions import db

class Task(db.Model):
    __tablename__ = "task"
    id = db.Column(db.Integer, primary_key=True)
    email_message_id = db.Column(db.String(300), unique=True, nullable=False, index=True)
    subject = db.Column(db.String(500))
    sender = db.Column(db.String(200))
    task_summary = db.Column(db.Text, nullable=False)
    status = db.Column(db.String(50), nullable=False, default="new", index=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow) # Sync Date
    
    # SLA Fields
    received_at = db.Column(db.DateTime, nullable=True) 

    task_detail = db.Column(db.Text)
    required_action = db.Column(db.Text)
    suggested_reply = db.Column(db.Text)
    
    # Reply Variants
    reply_acknowledge = db.Column(db.Text, nullable=True)
    reply_done = db.Column(db.Text, nullable=True)
    reply_delegate = db.Column(db.Text, nullable=True)

    # Action Taken
    action_taken = db.Column(db.String(50), nullable=True) 

    # Auto-Completion Evidence
    auto_completed_at = db.Column(db.DateTime, nullable=True)
    completion_evidence = db.Column(db.Text, nullable=True)

    ews_item_id = db.Column(db.String(300), unique=True)
    ews_change_key = db.Column(db.String(300))
    to_recipients_json = db.Column(db.Text)
    cc_recipients_json = db.Column(db.Text)
    status_updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    priority = db.Column(db.String(50), nullable=True, default='low', index=True)
    
    # Smart Classification
    project = db.Column(db.String(100), index=True, default="Unknown")
    tags_json = db.Column(db.Text, default="[]") 
    domain_hint = db.Column(db.String(100), default="Unknown")
    effort_estimate_hours = db.Column(db.Float, nullable=True)
    business_impact = db.Column(db.Text, nullable=True)

    # --- Executive Triage Fields ---
    triage_category = db.Column(db.String(50), default='deep_work', index=True) 
    delegated_to = db.Column(db.String(200), nullable=True)
    delegated_at = db.Column(db.DateTime, nullable=True)

    def to_dict(self):
        # Fallback to created_at if received_at is missing (Backward Compatibility)
        receipt_date = self.received_at if self.received_at else self.created_at
        
        return {
            "id": self.id,
            "email_message_id": self.email_message_id,
            "subject": self.subject,
            "sender": self.sender,
            "task_summary": self.task_summary,
            "status": self.status,
            "created_at": self.created_at.isoformat() + "Z" if self.created_at else None,
            "received_at": receipt_date.isoformat() + "Z" if receipt_date else None,
            "task_detail": self.task_detail,
            "required_action": self.required_action,
            "reply_acknowledge": self.reply_acknowledge,
            "reply_done": self.reply_done,
            "reply_delegate": self.reply_delegate,
            "suggested_reply": self.suggested_reply, 
            "action_taken": self.action_taken,
            
            # Evidence fields
            "auto_completed_at": self.auto_completed_at.isoformat() + "Z" if self.auto_completed_at else None,
            "completion_evidence": self.completion_evidence,

            "ews_item_id": self.ews_item_id,
            "ews_change_key": self.ews_change_key,
            "to_recipients_json": self.to_recipients_json,
            "cc_recipients_json": self.cc_recipients_json,
            "status_updated_at": self.status_updated_at.isoformat() + "Z" if self.status_updated_at else None,
            "priority": self.priority or 'low',
            "project": self.project,
            "tags": json.loads(self.tags_json) if self.tags_json else [],
            "domain_hint": self.domain_hint,
            "effort_estimate_hours": self.effort_estimate_hours,
            "business_impact": self.business_impact,

            # Executive Triage
            "triage_category": self.triage_category,
            "delegated_to": self.delegated_to,
            "delegated_at": self.delegated_at.isoformat() + "Z" if self.delegated_at else None
        }

class Person(db.Model):
    __tablename__ = "person"
    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(200), unique=True, nullable=False, index=True)
    name = db.Column(db.String(200))
    
    # Directory Enrichment
    job_title = db.Column(db.String(200))
    department = db.Column(db.String(200))
    office_location = db.Column(db.String(200))
    manager_name = db.Column(db.String(200))
    
    # Analytics
    interaction_count = db.Column(db.Integer, default=0)
    last_interaction_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    # Manual Classification
    manual_role = db.Column(db.String(100)) # e.g. 'VIP', 'Stakeholder', 'My Team'
    is_hidden = db.Column(db.Boolean, default=False) 
    
    # Project Mapping
    projects_json = db.Column(db.Text, default="[]") 

    def to_dict(self):
        return {
            "id": self.id,
            "email": self.email,
            "name": self.name,
            "job_title": self.job_title,
            "department": self.department,
            "office_location": self.office_location,
            "manager_name": self.manager_name,
            "interaction_count": self.interaction_count,
            "last_interaction_at": self.last_interaction_at.isoformat() + "Z" if self.last_interaction_at else None,
            "manual_role": self.manual_role,
            "is_hidden": self.is_hidden,
            "projects": json.loads(self.projects_json) if self.projects_json else []
        }

class AppSettings(db.Model):
    __tablename__ = "app_settings"
    key = db.Column(db.String(100), primary_key=True)
    value = db.Column(db.Text, nullable=False)

class DailySummary(db.Model):
    __tablename__ = "daily_summary"
    id = db.Column(db.Integer, primary_key=True)
    summary_date = db.Column(db.Date, nullable=False, default=date.today)
    raw_snippets = db.Column(db.Text)
    content = db.Column(db.Text)
    status = db.Column(db.String(50), nullable=False, default="pending") 
    audio_file_path = db.Column(db.String(500), nullable=True)

    __table_args__ = (
        db.UniqueConstraint('summary_date', name='uq_summary_date'),
    )

    def to_dict(self):
        return {
            "id": self.id,
            "summary_date": self.summary_date.isoformat(),
            "content": self.content,
            "status": self.status,
            "audio_file_path": self.audio_file_path
        }