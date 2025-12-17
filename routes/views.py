from flask import Blueprint, render_template, send_from_directory
from config import Config

view_bp = Blueprint('views', __name__)

@view_bp.route('/')
def index():
    return render_template('index.html')

@view_bp.route('/archive')
def archive_page():
    return render_template('archive.html')

@view_bp.route('/news')
def news_page():
    return render_template('news.html')

@view_bp.route('/reports')
def reports_page():
    return render_template('reports.html')

# --- NEW: Circle Management Page ---
@view_bp.route('/circle')
def circle_page():
    return render_template('circle.html')

@view_bp.route('/favicon.ico')
def favicon():
    return '', 204

@view_bp.route(f'/{Config.BRIEFING_AUDIO_URL_PREFIX}/<filename>')
def serve_briefing_audio(filename):
    return send_from_directory(Config.BRIEFING_AUDIO_PATH, filename)

@view_bp.route('/reports/<filename>')
def serve_report(filename):
    return send_from_directory(Config.REPORTS_PATH, filename)