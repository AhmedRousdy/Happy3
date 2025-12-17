import os
import logging
import re
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# Find the absolute path of the directory this file is in
basedir = os.path.abspath(os.path.dirname(__file__))

class Config:
    """
    Central configuration class.
    Includes Smart Classification Defaults & Dynamic Prompt Template.
    """
    LOG_LEVEL = "DEBUG"
    
    # --- 1. App Configuration ---
    EWS_SERVER = os.environ.get('EWS_SERVER')
    EWS_EMAIL = os.environ.get('EWS_EMAIL')
    EWS_PASSWORD = os.environ.get('EWS_PASSWORD')
    MY_PRIMARY_EMAIL_FROM_ENV = os.environ.get('MY_PRIMARY_EMAIL')

    OLLAMA_HOST = os.environ.get('OLLAMA_HOST', 'http://127.0.0.1:11434')
    OLLAMA_MODEL = os.environ.get('OLLAMA_MODEL', 'deepseek-v3.1:671b-cloud')
    OLLAMA_TRIAGE_MODEL = os.environ.get('OLLAMA_TRIAGE_MODEL', 'deepseek-v3.1:671b-cloud')
    
    TIMEZONE = os.environ.get('TIMEZONE', 'Asia/Dubai')
    DB_NAME = 'tasks.db'
    
    # Paths
    BRIEFING_AUDIO_PATH = os.path.join(basedir, "static", "briefings")
    BRIEFING_AUDIO_URL_PREFIX = "briefings"
    REPORTS_PATH = os.path.join(basedir, "static", "reports")

    # --- 2. Database Configuration ---
    SQLALCHEMY_DATABASE_URI = os.environ.get('DATABASE_URL') or \
        'sqlite:///' + os.path.join(basedir, DB_NAME)
    SQLALCHEMY_TRACK_MODIFICATIONS = False

    # --- 3. App Behavior ---
    MAX_EMAILS_PER_SYNC = 80
    OLLAMA_TIMEOUT = 600
    CONNECTION_TIMEOUT = 300
    DEFAULT_SYNC_DAYS = 3
    
    # UPDATED: Archive tasks 2 days after closing
    ARCHIVE_AFTER_DAYS = 2
    
    OLLAMA_KEEP_ALIVE = '5m'
    OLLAMA_TRUNCATE_CHARS = 3000
    BRIEFING_KEEP_DAYS = 7
    
    # NEW: Service Level Agreement (SLA)
    SLA_RESPONSE_DAYS = 4

    ENABLE_WEEKLY_REPORT = True
    WEEKLY_REPORT_DAY = 'sun'
    WEEKLY_REPORT_HOUR = 20
    
    ENABLE_DAILY_BRIEFING = True
    DAILY_BRIEFING_HOUR = 8

    # --- 4. Regex Patterns ---
    SPAM_PATTERNS = [
        r'out of office', r'automatic reply', r'delivery status notification',
        r'undeliverable', r'mailer-daemon', r'unsubscribe', r'privacy policy',
        r'view in browser', r'^(thank you|thanks|got it|received|ok)$',
        r'خارج المكتب', r'رد تلقائي', r'إشعار تسليم', r'غير قابل للتسليم', r'إلغاء الاشتراك',
    ]
    COMPILED_SPAM_REGEX = [re.compile(p, re.IGNORECASE | re.DOTALL) for p in SPAM_PATTERNS]

    HIGH_PRIORITY_PATTERNS = [
        r'\b(urgent|immediately|asap|critical|!|as soon as possible)\b',
        r'subject:.*(urgent|asap)',
        r'\b(deadline|due by)\b.*(today|eod)\b',
        r'at your earliest convenience',
        r'\b(عاجل|فوري|هام جدا|مطلوب الرد)\b'
    ]
    COMPILED_HIGH_PRIORITY_REGEX = [re.compile(p, re.IGNORECASE | re.DOTALL) for p in HIGH_PRIORITY_PATTERNS]

    MEDIUM_PRIORITY_PATTERNS = [
        r'\b(important|please review|action required|for your review)\b',
        r'\b(deadline|due by)\b',
        r'\b(هام|يرجى المراجعة|مطلوب إجراء|للمراجعة|للعلم)\b'
    ]
    COMPILED_MEDIUM_PRIORITY_REGEX = [re.compile(p, re.IGNORECASE | re.DOTALL) for p in MEDIUM_PRIORITY_PATTERNS]

    # --- Executive Prefixes (Phase 2) ---
    SUBJECT_PREFIXES = {
        'URGENT': re.compile(r'\[URGENT\]', re.IGNORECASE),
        'APPROVE': re.compile(r'\[APPROVE\]', re.IGNORECASE),
        'FYI': re.compile(r'\[FYI\]', re.IGNORECASE)
    }

    # --- 5. Classification Defaults (Used if DB is empty) ---
    DEFAULT_PROJECTS = ["CTS", "CRM", "ERP", "Mobile App", "HR Portal", "DubaiNow", "GIS", "Procurement", "Finance", "Internal", "Personal", "Unknown"]
    DEFAULT_TAGS = ["Bug", "Feature Request", "Information Request", "Service Request", "Approval", "Access Request", "Meeting", "Report", "Complaint", "Security", "Onboarding", "Budget", "Legal", "Vendor-Related", "Training", "Update", "Other"]
    DEFAULT_DOMAINS = ["IT Support", "Finance", "Procurement", "Legal", "HR", "Facilities", "Security", "Vendor", "Unknown"]

    SYSTEM_PROMPT_TRIAGE = """
You are an expert bilingual (English and Arabic) email triage assistant.
Your job is to classify an email into ONLY ONE of three categories:
1. **ACTION**: Requires direct action, reply, approval, or task.
2. **INFO**: FYI, newsletter, report, or update.
3. **SPAM**: Junk, marketing, or simple acknowledgement.
Respond with ONLY the single word: **ACTION**, **INFO**, or **SPAM**.
"""

    # --- DYNAMIC PROMPT TEMPLATE (EXECUTIVE TRIAGE EDITION) ---
    SYSTEM_PROMPT_TEMPLATE = """
You are an expert bilingual (English and Arabic) Executive Assistant.
Your goal is to extract structured task data from an email and TRIAGE it into the correct workflow folder.

**TRIAGE LOGIC (The 5-Folder System):**
1. **quick_action**: Tasks taking < 5 minutes, approvals (Yes/No), sign-offs, or simple questions.
2. **deep_work**: Complex tasks taking > 15 minutes, strategy, drafting proposals, or personnel reviews.
3. **waiting_for**: Tasks I must delegate to someone else.

Your response MUST be a valid JSON object matching this exact schema:
{
  "is_task": "YES",
  "task_confidence_score": <0-100>,
  "task_summary": "<max 10 words, concise title, same language as email>",
  "task_detail": "<1-2 sentence context/description>",
  "required_action": "<specific action user must take>",
  "reply_options": {
      "acknowledge": "<Short acknowledgment (2-4 sentences)>",
      "done": "<Confirmation of completion (2-4 sentences)>",
      "delegate": "<Delegation message assigning responsibility to someone else>"
  },
  "project": "<Infer from list below>",
  "tags": ["<Choose from list below>"],
  "domain_hint": "<Choose from list below>",
  "effort_estimate_minutes": <integer estimate of time required>,
  "triage_category": "<quick_action | deep_work | waiting_for>",
  "delegated_to_hint": "<Name of person to delegate to, if applicable, else null>",
  "business_impact": "<one-sentence business value>"
}

**ALLOWED PROJECTS:**
{{PROJECTS}}

**ALLOWED TAGS:**
{{TAGS}}

**ALLOWED DOMAINS:**
{{DOMAINS}}

RULES:
1.  **is_task**: Set to "YES" (as this prompt is only run on ACTION emails).
2.  **Language**: Match the language of the email for all text fields.
3.  **Category Logic**:
    - If email asks for "Approval", "Sign-off", or simple reply -> "quick_action".
    - If email requires detailed analysis or document creation -> "deep_work".
    - If email explicitly asks you to assign it to [Name] -> "waiting_for" and set "delegated_to_hint".
4.  **JSON ONLY**: Return raw JSON without markdown formatting.
"""

    SYSTEM_PROMPT_SUMMARIZER = """
You are an expert executive assistant. Your job is to write a clean, professional, and concise "Daily Briefing"
from a list of email snippets, which may be in **English or Arabic**.

The user's timezone is Dubai (GMT+4).

RULES:
1.  Analyze all snippets. Each snippet has a "From", "Subject", and "Snippet" field.
2.  **Filter Aggressively:** Ignore spam, simple "thank you" replies, "out of office" alerts, and marketing/newsletters.
3.  **Categorize:** Group the important items into logical categories (e.g., "Project Updates", "Company News", "FYI", "Pending Invitations").
    - **Language:** Create separate categories for English and Arabic items if necessary.
4.  **Synthesize:** Do not just list the emails. Summarize the information.
5.  **Format:** Use clear prose and bullet points for readability.
6.  **Tone:** Professional, direct, and approachable.
7.  **No Snippets:** If no meaningful snippets are provided, respond with *only* this text: "No significant news to report today."
8.  **Output:** Do not include a greeting ("Hi") or sign-off ("Best"). Just provide the briefing.
"""

    # --- NEW: Consolidated Report Prompt (Business Value Focus + Executive Scorecard + Effort Analysis) ---
    SYSTEM_PROMPT_CONSOLIDATED_REPORT = """
You are an expert Business Analyst. Your task is to process the provided structured data of tasks and create a consolidated executive summary.

**OBJECTIVE:**
Create a high-level, business-focused report that highlights **value delivered** rather than just listing operational tasks.

**CONTEXT - RESOURCE CAPACITY:**
- Standard work week: 5 days, 8 hours/day (Total 40 hours/person).
- **CRITICAL:** If the total effort exceeds 40 hours, you MUST highlight this as **"Extra Effort / High Utilization"** in the Scorecard and Executive Summary.

**INPUT DATA:**
The input is a list of "Achievements" (Completed Tasks) and "Planned" (Open Tasks).

**OUTPUT FORMAT:**
Generate strictly **HTML code** (no markdown, no ```html``` fences).
Return only the inner content (tables and summary) to be embedded in a report body.

**STRUCTURE:**

1.  **<h2>Executive Scorecard</h2>**
    - Create a clean summary box or list with these metrics (calculate them from input data):
        - **Total Tasks Completed:** [Count]
        - **SLA Compliance Rate:** [Percentage of tasks 'On Time' vs 'Overdue'] (Estimate if exact numbers unavailable)
        - **Total Effort Spent:** [Sum of hours] / 40 Hours (Standard Capacity)
        - **Utilization Status:** [If > 40h: "OVER CAPACITY (Extra Effort)"; If <= 40h: "Within Capacity"]
        - **Critical Risks:** [Count of items flagged as risk/blocker]

2.  **<h2>Achievements (Completed Work)</h2>**
    - Create a clean HTML table with headers: **Project**, **Description**, **Impact**.
    - Use `<table style="width:100%; border-collapse: collapse; margin-bottom: 2rem;">`
    - Use `th` with background `#f8fafc` and text color `#475569`.
    - Use `td` with `vertical-align: top; padding: 0.75rem; border: 1px solid #e2e8f0;`.
    - **Description Column**: Use `<ul>` for bullet points. Remove technical jargon (e.g., instead of "Fixed null pointer", say "Resolved stability issue").
    - **Impact Column**: Focus on **Business Value** (e.g., "Improved efficiency", "Ensured compliance").

3.  **<h2>Planned Work</h2>**
    - Create a similar table for planned tasks with columns: **Project**, **Planned Task**, **Expected Value**.

4.  **<h2>Decisions Required & Blockers</h2>**
    - Identify any tasks that explicitly mention "Approval needed", "Waiting for", "Budget", or "Blocker".
    - List them clearly. If none, state "No critical blockers identified."

5.  **<h2>Executive Summary</h2>**
    - A brief paragraph summarizing key themes (e.g., "This week focused on security compliance and infrastructure stability...").
    - **MANDATORY:** Explicitly mention if the team went above and beyond standard hours (extra effort) to deliver these results.

**TONE:**
- Professional, executive, and results-oriented.
- Avoid passive voice.

**IMPORTANT:**
- Do NOT wrap the output in markdown code blocks.
- Do NOT include `<html>`, `<head>`, or `<body>` tags. Just the content.
"""