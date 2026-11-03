"""Real interactive Kali PTY sessions for the authenticated local Atlas viewer.

Each view owns one bash process; stdout/stderr are read from its PTY and retained
in a bounded in-memory ring buffer. No command is started until Open Terminal.
"""
import errno
import fcntl
import os
import pty
import select
import signal
import struct
import subprocess
import termios
import threading

GUARD=threading.RLock()
SESSIONS={}
LIMIT=110000
MAX_INPUT=8192

def _read(session):
    fd=session["fd"]
    while True:
        try:
            ready,_,_=select.select([fd],[],[],0.5)
            if not ready:
                if session["proc"].poll() is not None:break
                continue
            data=os.read(fd,8192)
            if not data:break
            with session["guard"]:
                session["output"]+=data.decode("utf-8","replace")
                if len(session["output"])>LIMIT:
                    excess=len(session["output"])-LIMIT
                    session["output"]=session["output"][excess:]
                    session["offset"]+=excess
        except (OSError,ValueError):
            break
    with session["guard"]:session["finished"]=True
    try:os.close(fd)
    except OSError:pass

def start(slot):
    if type(slot) is not int or slot not in (1,2,3):raise ValueError("Invalid terminal slot")
    with GUARD:
        current=SESSIONS.get(slot)
        if current and current["proc"].poll() is None:return {"running":True,"slot":slot}
        master,slave=pty.openpty()
        env=dict(os.environ)
        env["TERM"]="xterm-256color"
        env["ATLAS_TERMINAL"]="1"
        cmd=["/bin/bash","--login","-i"]
        try:
            proc=subprocess.Popen(cmd,stdin=slave,stdout=slave,stderr=slave,
                close_fds=True,start_new_session=True,env=env,cwd=os.path.expanduser("~"))
        except Exception:
            os.close(master);os.close(slave);raise
        os.close(slave)
        session={"fd":master,"proc":proc,"output":"","offset":0,
                 "guard":threading.RLock(),"finished":False}
        SESSIONS[slot]=session
        threading.Thread(target=_read,args=(session,),daemon=True,name="atlas-pty-"+str(slot)).start()
        return {"running":True,"slot":slot,"pid":proc.pid}

def output(slot,offset=0):
    if type(slot) is not int or slot not in (1,2,3):raise ValueError("Invalid terminal slot")
    if type(offset) is not int or offset<0:raise ValueError("Invalid terminal offset")
    with GUARD:
        session=SESSIONS.get(slot)
        if not session:return {"running":False,"slot":slot,"output":"","offset":0,"next_offset":0}
        with session["guard"]:
            pos=max(0,offset-session["offset"])
            delta=session["output"][pos:]
            next_offset=session["offset"]+len(session["output"])
            return {"running":session["proc"].poll() is None,
                "slot":slot,"output":delta,"offset":session["offset"],"next_offset":next_offset}

def write(slot,text):
    if type(slot) is not int or slot not in (1,2,3):raise ValueError("Invalid terminal slot")
    if not isinstance(text,str) or len(text)>MAX_INPUT:raise ValueError("Invalid terminal input")
    with GUARD:
        session=SESSIONS.get(slot)
        if not session or session["proc"].poll() is not None:raise ValueError("Start this terminal first")
        os.write(session["fd"],text.encode("utf-8"))
        return {"written":True}

def resize(slot,cols,rows):
    if type(slot) is not int or slot not in (1,2,3):raise ValueError("Invalid slot")
    if type(cols) is not int or type(rows) is not int or not 20<=cols<=250 or not 10<=rows<=100:
        raise ValueError("Invalid terminal size")
    with GUARD:
        session=SESSIONS.get(slot)
        if not session or session["proc"].poll() is not None:return {"resized":False}
        fcntl.ioctl(session["fd"],termios.TIOCSWINSZ,struct.pack("HHHH",rows,cols,0,0))
        return {"resized":True}

def stop(slot):
    with GUARD:
        session=SESSIONS.get(slot)
        if session and session["proc"].poll() is None:
            os.killpg(session["proc"].pid,signal.SIGHUP)
        return {"stopped":True}
