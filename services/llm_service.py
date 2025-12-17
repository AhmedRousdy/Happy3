# Filename: services/llm_service.py
# Role: Service for interacting with local LLM (Ollama)

import logging
import requests
import json
from config import Config

logger = logging.getLogger(__name__)

def call_ollama(model, prompt, system=None, json_format=False):
    """Generic wrapper for Ollama API."""
    try:
        url = f"{Config.OLLAMA_HOST}/api/generate"
        payload = {
            "model": model,
            "prompt": prompt,
            "stream": False,
            "options": {
                "num_ctx": 4096, # Larger context for reports
                "temperature": 0.2 # Lower temp for consistent reporting
            }
        }
        
        if system:
            payload["system"] = system
            
        if json_format:
            payload["format"] = "json"
            
        logger.info(f"Calling Ollama model: {model}")
        response = requests.post(url, json=payload, timeout=getattr(Config, 'OLLAMA_TIMEOUT', 600))
        response.raise_for_status()
        
        result = response.json()
        return result.get('response', '').strip()
        
    except requests.exceptions.RequestException as e:
        logger.error(f"Ollama Connection Error: {e}")
        return None
    except Exception as e:
        logger.error(f"Ollama Error: {e}")
        return None

def check_and_pull_model(model_name):
    """Checks if model exists, pulls if not."""
    try:
        # Check local tags
        tags_url = f"{Config.OLLAMA_HOST}/api/tags"
        resp = requests.get(tags_url, timeout=10)
        if resp.status_code == 200:
            models = [m['name'] for m in resp.json().get('models', [])]
            # Simple check if model string is in the list of names
            if any(model_name in m for m in models):
                logger.info(f"Model {model_name} found locally.")
                return True
        
        logger.info(f"Model {model_name} not found locally. Attempting pull...")
        pull_url = f"{Config.OLLAMA_HOST}/api/pull"
        # Streaming pull request
        with requests.post(pull_url, json={"name": model_name}, stream=True, timeout=300) as pull_resp:
            pull_resp.raise_for_status()
            for line in pull_resp.iter_lines():
                if line:
                    logger.debug(f"Pulling {model_name}: {line.decode('utf-8')}")
        
        logger.info(f"Model {model_name} pulled successfully.")
        return True
        
    except Exception as e:
        logger.error(f"Error checking/pulling model {model_name}: {e}")
        return False

def run_triage_model(content, model_name):
    system = Config.SYSTEM_PROMPT_TRIAGE
    user_prompt = f"Email Content:\n{content}"
    return call_ollama(model_name, user_prompt, system=system) or "INFO"

def extract_task_json(content, model_name):
    # Fetch dynamic settings
    from utils import get_json_setting
    projects = get_json_setting('classification_projects', Config.DEFAULT_PROJECTS)
    tags = get_json_setting('classification_tags', Config.DEFAULT_TAGS)
    domains = get_json_setting('classification_domains', Config.DEFAULT_DOMAINS)
    
    # Inject into prompt
    system = Config.SYSTEM_PROMPT_TEMPLATE.replace('{{PROJECTS}}', str(projects))\
                                          .replace('{{TAGS}}', str(tags))\
                                          .replace('{{DOMAINS}}', str(domains))
                                          
    user_prompt = f"Extract task details from:\n{content}"
    
    response = call_ollama(model_name, user_prompt, system=system, json_format=True)
    if not response: return None
    
    try:
        return json.loads(response)
    except json.JSONDecodeError:
        logger.error("Failed to decode JSON from LLM")
        return None

def generate_summary_text(snippets_text, model_name):
    system = Config.SYSTEM_PROMPT_SUMMARIZER
    return call_ollama(model_name, snippets_text, system=system)

def generate_consolidated_report_content(data_text, model_name):
    """
    Sends structured task data (text) to LLM to consolidate and summarize.
    """
    system = Config.SYSTEM_PROMPT_CONSOLIDATED_REPORT
    user_prompt = f"<DATA_INPUT>\n{data_text}\n</DATA_INPUT>"
    
    return call_ollama(model_name, user_prompt, system=system)