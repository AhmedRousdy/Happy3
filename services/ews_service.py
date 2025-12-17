from exchangelib import Credentials, Account, Configuration, DELEGATE, Mailbox, FileAttachment
from exchangelib.items import Message, Contact
from exchangelib.protocol import BaseProtocol
from exchangelib.ewsdatetime import EWSTimeZone
import pytz
import logging
from config import Config

logger = logging.getLogger(__name__)

# EWS Global
_account = None

def init_ews():
    global _account
    if _account: return _account
    
    try:
        BaseProtocol.TIMEOUT = getattr(Config, 'CONNECTION_TIMEOUT', 300)
        creds = Credentials(username=Config.EWS_EMAIL, password=Config.EWS_PASSWORD)
        config = Configuration(server=Config.EWS_SERVER, credentials=creds)
        
        tz = pytz.timezone(getattr(Config, "TIMEZONE", "Asia/Dubai"))
        ews_tz = EWSTimeZone.from_pytz(tz)
        
        _account = Account(
            primary_smtp_address=Config.EWS_EMAIL,
            config=config,
            autodiscover=False,
            access_type=DELEGATE
        )
        _account.default_timezone = ews_tz
        logger.info(f"EWS Connected: {_account.primary_smtp_address}")
        return _account
    except Exception as e:
        logger.error(f"EWS Connection Failed: {e}")
        return None

def get_account():
    return _account or init_ews()

def fetch_emails(start_time, end_time):
    account = get_account()
    if not account: raise Exception("EWS not connected")
    
    my_email = Config.MY_PRIMARY_EMAIL_FROM_ENV.lower()
    max_emails = getattr(Config, 'MAX_EMAILS_PER_SYNC', 50)
    
    # Fetch recent items (Inbox)
    recent_items = account.inbox.filter(
        item_class='IPM.Note',
        datetime_received__range=(start_time, end_time)
    ).order_by('-datetime_received')[:max_emails]
    
    final_list = []
    for item in recent_items:
        if not isinstance(item, Message): continue
        is_for_me = False
        if item.to_recipients:
            for r in item.to_recipients:
                if r.email_address and r.email_address.lower() == my_email:
                    is_for_me = True; break
        if is_for_me: final_list.append(item)
        
    return final_list

def fetch_sent_emails(start_time, end_time):
    """
    Fetches recent emails from 'Sent Items' to check for task completions AND network discovery.
    """
    account = get_account()
    if not account: return []
    
    try:
        # We need in_reply_to property to match threading
        # Note: 'in_reply_to' is the Message-ID of the parent email
        # Added to_recipients/cc_recipients for Network Scan
        sent_items = account.sent.filter(
            item_class='IPM.Note',
            datetime_sent__range=(start_time, end_time)
        ).only(
            'message_id', 
            'in_reply_to', 
            'subject', 
            'body', 
            'text_body', 
            'datetime_sent',
            'to_recipients',
            'cc_recipients',
            'sender'
        ).order_by('-datetime_sent')[:50]
        
        return list(sent_items)
    except Exception as e:
        logger.error(f"Error fetching sent items: {e}")
        return []

def get_gal_details(email_address):
    account = get_account()
    if not account or not email_address: return None
    try:
        matches = account.protocol.resolve_names([email_address], return_full_contact_data=True)
        if not matches: return None
        
        # Handle various return types from resolve_names
        candidate = matches[0]
        contact = None
        
        # Sometimes it returns a Mailbox object directly, sometimes a Contact, sometimes a tuple
        if isinstance(candidate, tuple):
             # Usually (Mailbox, Contact) or similar
             for item in candidate:
                 if isinstance(item, Contact):
                     contact = item
                     break
        elif isinstance(candidate, Contact):
            contact = candidate
        elif hasattr(candidate, 'email_address'): # Mailbox object or similar
             # If it's just a Mailbox, we might not have full details, but let's check
             pass

        if contact:
             return {
                'name': contact.display_name or contact.name,
                'job_title': getattr(contact, 'job_title', None),
                'department': getattr(contact, 'department', None),
                'office': getattr(contact, 'office_location', None),
                'manager': getattr(contact, 'manager', None) 
            }
            
        # Fallback if we just got a Mailbox object or nothing useful
        if hasattr(candidate, 'email_address') and candidate.email_address.lower() == email_address.lower():
             return {
                 'name': candidate.name,
                 'job_title': None, 'department': None, 'office': None, 'manager': None
             }

    except Exception as e:
        logger.warning(f"GAL Lookup failed for {email_address}: {e}")
    return None

def fetch_email_content(item_id, change_key):
    account = get_account()
    if not account: raise Exception("EWS not connected")
    try:
        items = list(account.fetch(ids=[(item_id, change_key)]))
        if not items: return None
        item = items[0]
        if isinstance(item, Exception): raise item

        def format_recipients(recipients):
            if not recipients: return []
            return [{"name": r.name, "email": r.email_address} for r in recipients if r]

        attachments = []
        if item.attachments:
            for att in item.attachments:
                if isinstance(att, FileAttachment):
                    attachments.append({
                        "name": att.name,
                        "content_type": att.content_type,
                        "size": att.size,
                        "id": att.attachment_id.id 
                    })

        # Body fix
        body_content = item.body or item.text_body or ""

        return {
            "subject": item.subject,
            "sender": {"name": item.sender.name, "email": item.sender.email_address} if item.sender else {"name": "Unknown", "email": ""},
            "to": format_recipients(item.to_recipients),
            "cc": format_recipients(item.cc_recipients),
            "sent_at": item.datetime_sent.isoformat() if item.datetime_sent else None,
            "received_at": item.datetime_received.isoformat() if item.datetime_received else None,
            "body": str(body_content),
            "attachments": attachments
        }
    except Exception as e:
        logger.error(f"Error fetching email content: {e}")
        raise e