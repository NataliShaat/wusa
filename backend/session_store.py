"""
In-memory session store - a hackathon-demo simplification, not meant to
survive a process restart or run across multiple worker processes. Deploy
with a single uvicorn worker and no --reload.
"""

import os
import sys
import uuid

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from action_protocol import MockBankBackend


class Session:
    def __init__(self):
        self.backend = MockBankBackend()
        self.pending_intent = None
        # Arabic dialect detected from the user's speech by nlu.py (e.g.
        # "Saudi/Gulf", "Egyptian"). None until the user has spoken once;
        # tts.py phrases responses in this dialect once known.
        self.dialect = None


_sessions = {}


def create_session() -> str:
    session_id = str(uuid.uuid4())
    _sessions[session_id] = Session()
    return session_id


def get_session(session_id: str):
    return _sessions.get(session_id)
