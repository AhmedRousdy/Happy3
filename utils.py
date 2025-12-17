import re
import json
import logging
from typing import Optional, Dict, Any, List
from config import Config
from models import AppSettings
from extensions import db

logger = logging.getLogger(__name__)

def get_setting(key: str, default: Optional[str] = None) -> Optional[str]:
    """Fetches a single setting from the AppSettings table."""
    try:
        setting = db.session.get(AppSettings, key)
        return setting.value if setting else default
    except Exception as e:
        logger.warning(f"Error fetching setting '{key}', using default. Error: {e}")
        return default

def get_json_setting(key: str, default_list: List[str]) -> List[str]:
    """Fetches a JSON list setting, returning default_list if empty/invalid."""
    val = get_setting(key)
    if not val:
        return default_list
    try:
        parsed = json.loads(val)
        if isinstance(parsed, list):
            return parsed
        return default_list
    except:
        return default_list

def save_setting(key: str, value: str) -> bool:
    """Saves or updates a setting in the AppSettings table."""
    try:
        setting = db.session.get(AppSettings, key)
        if setting:
            setting.value = value
        else:
            setting = AppSettings(key=key, value=value)
            db.session.add(setting)
        db.session.commit()
        return True
    except Exception as e:
        logger.error(f"Error saving setting '{key}': {e}")
        db.session.rollback()
        return False

def construct_dynamic_prompt() -> str:
    """
    Builds the System Prompt dynamically using User Settings (Projects/Tags/Domains).
    Falls back to Config defaults if DB is empty.
    """
    projects = get_json_setting('classification_projects', Config.DEFAULT_PROJECTS)
    tags = get_json_setting('classification_tags', Config.DEFAULT_TAGS)
    domains = get_json_setting('classification_domains', Config.DEFAULT_DOMAINS)

    # Use the template from Config and inject the user's specific lists
    template = Config.SYSTEM_PROMPT_TEMPLATE
    
    prompt = template.replace("{{PROJECTS}}", json.dumps(projects))
    prompt = prompt.replace("{{TAGS}}", json.dumps(tags))
    prompt = prompt.replace("{{DOMAINS}}", json.dumps(domains))
    
    return prompt

def clean_email_body(body_text: str) -> str:
    """Cleans email body: removes disclaimers, forward headers, etc."""
    if not body_text:
        return ""

    body_text, *_ = body_text.split("Disclaimer:", 1)
    body_text, *_ = body_text.split("إشعار:", 1)
    
    truncate_chars = getattr(Config, 'OLLAMA_TRUNCATE_CHARS', 2000)
    
    cleaned_lines = []
    lines = body_text.splitlines()
    for line in lines:
        stripped_line = line.strip()
        
        if stripped_line.startswith(('From:', 'Sent:', 'To:', 'Subject:')): break
        if stripped_line.startswith('>'): continue
        if stripped_line in ['--', '---', '________________________________']: break
        if "this email and any attachments" in stripped_line.lower(): break
        
        cleaned_lines.append(line)
        
    full_cleaned_body = "\n".join(cleaned_lines).strip()
    
    if truncate_chars > 0 and len(full_cleaned_body) > truncate_chars:
        return full_cleaned_body[:truncate_chars]
    
    return full_cleaned_body

def extract_json_from_response(response_text: str) -> Optional[Dict[str, Any]]:
    """Extracts JSON object from LLM response text."""
    if not response_text:
        return None
    try:
        text_to_parse = response_text
        if "```json" in text_to_parse:
            text_to_parse = text_to_parse.split("```json")[1].split("```")[0]
        elif "```" in text_to_parse:
            text_to_parse = text_to_parse.split("```")[1].split("```")[0]
            
        start = text_to_parse.find('{')
        end = text_to_parse.rfind('}') + 1
        
        if start == -1 or end == 0:
            return None
            
        json_str = text_to_parse[start:end]
        json_str = json_str.replace('\n', ' ')
        return json.loads(json_str)
    except Exception as e:
        logger.error(f"JSON Parse Error: {e}")
        return None

def extract_snippet(cleaned_body: str, min_len: int = 30, max_chars: int = 250) -> str:
    """Extracts the first meaningful line of an email for a snippet."""
    if not cleaned_body: return "No content"
    lines = [ln.strip() for ln in cleaned_body.splitlines() if ln.strip()]
    for line in lines:
        l = line.lower()
        if (
            len(line) >= min_len and 
            not l.startswith(("hi ", "dear ", "hello", "good morning", "good afternoon")) and
            not l.startswith(">")
        ):
            return line[:max_chars]
    return " ".join(lines[:3])[:max_chars]

def get_priority_from_text(email_content: str) -> str:
    for regex in Config.COMPILED_HIGH_PRIORITY_REGEX:
        if regex.search(email_content): return 'high'
    for regex in Config.COMPILED_MEDIUM_PRIORITY_REGEX:
        if regex.search(email_content): return 'medium'
    return 'low'

def is_email_junk_by_regex(email_content: str) -> bool:
    for regex in Config.COMPILED_SPAM_REGEX:
        if regex.search(email_content): return True
    return False