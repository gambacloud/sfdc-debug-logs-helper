from fastapi import FastAPI, Request, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime, timedelta
import os
import sys
import asyncio

from logger import log, find_open_port
import sf_service
import parser

app = FastAPI(title="SFDC Debug Logs Helper")

class CreateTraceRequest(BaseModel):
    user_id: str
    minutes: int = 20
    org: Optional[str] = None

class DeleteLogsRequest(BaseModel):
    log_ids: List[str]
    org: Optional[str] = None

# Mount static files (CSS, JS)
app.mount("/static", StaticFiles(directory="static"), name="static")

# Templates setup
templates = Jinja2Templates(directory="templates")

@app.middleware("http")
async def log_requests(request: Request, call_next):
    log.info(f"Request started: {request.method} {request.url.path}")
    response = await call_next(request)
    log.info(f"Request completed: {request.method} {request.url.path} - Status: {response.status_code}")
    return response

@app.get("/", response_class=HTMLResponse)
async def serve_ui(request: Request):
    return templates.TemplateResponse(request=request, name="index.html")

@app.get("/api/orgs")
async def list_orgs():
    """List authenticated SF Orgs."""
    try:
        result = await sf_service.run_sf_command(["org", "list"])
        # org list returns nonScratchOrgs and scratchOrgs in the result
        orgs = []
        if 'nonScratchOrgs' in result:
            orgs.extend(result['nonScratchOrgs'])
        if 'scratchOrgs' in result:
            orgs.extend(result['scratchOrgs'])
        return {"orgs": orgs}
    except Exception as e:
        log.error(f"Error listing orgs: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/orgs/login")
async def login_org():
    """Trigger device login to authenticate a new org."""
    try:
        # We'll use device login so the user gets a code if they are remote, 
        # but 'sf org login web' is also fine locally. 
        # Using web for fastest local dev experience since this is a local helper.
        # Run fire-and-forget so UI doesn't hang waiting for browser auth
        asyncio.create_task(sf_service.run_sf_command(["org", "login", "web"]))
        return {"message": "Opening browser for Salesforce authentication..."}
    except Exception as e:
        log.error(f"Error initiating org login: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/users/search")
async def search_users(q: str = "", org: Optional[str] = None):
    """Search active users by name."""
    try:
        query = f"SELECT Id, Name, Username FROM User WHERE IsActive = true AND Name LIKE '%{q}%' ORDER BY Name LIMIT 20"
        records = await sf_service.query_soql(query, target_org=org, use_tooling_api=False)
        return {"users": records}
    except Exception as e:
        log.error(f"Error searching users: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/traces")
async def list_traces(org: Optional[str] = None):
    """List recent trace flags."""
    try:
        # Tooling API allows querying TraceFlag
        query = "SELECT Id, TracedEntityId, ExpirationDate, StartDate, DebugLevelId FROM TraceFlag ORDER BY CreatedDate DESC LIMIT 50"
        traces = await sf_service.query_soql(query, target_org=org, use_tooling_api=True)
        # We need to map TracedEntityId to User Names, let's gather them
        user_ids = [t['TracedEntityId'] for t in traces if t.get('TracedEntityId', '').startswith('005')]
        user_map = {}
        if user_ids:
            ids_str = "','".join(user_ids)
            users = await sf_service.query_soql(f"SELECT Id, Name FROM User WHERE Id IN ('{ids_str}')", target_org=org, use_tooling_api=False)
            user_map = {u['Id']: u['Name'] for u in users}
        
        for t in traces:
            t['TracedEntityName'] = user_map.get(t['TracedEntityId'], 'Unknown')
            
        return {"traces": traces}
    except Exception as e:
        log.error(f"Error listing traces: {e}")
        raise HTTPException(status_code=500, detail=str(e))

class CreateTraceRequest(BaseModel):
    user_id: str
    minutes: int = 20
    org: Optional[str] = None

@app.post("/api/traces")
async def create_trace(req: CreateTraceRequest):
    """Create a new 20-min TraceFlag for a user."""
    try:
        # 1. Get a DebugLevel (SFDC_DevConsole is usually available)
        level_query = "SELECT Id FROM DebugLevel WHERE DeveloperName = 'SFDC_DevConsole' LIMIT 1"
        levels = await sf_service.query_soql(level_query, target_org=req.org, use_tooling_api=True)
        if not levels:
            # Fallback if DevConsole doesn't exist, we could create one or grab the first available
            levels = await sf_service.query_soql("SELECT Id FROM DebugLevel LIMIT 1", target_org=req.org, use_tooling_api=True)
            if not levels:
                raise HTTPException(status_code=400, detail="No DebugLevel found in org. Please create one.")
        
        debug_level_id = levels[0]['Id']
        
        # 2. Format dates
        start_date = datetime.utcnow()
        exp_date = start_date + timedelta(minutes=req.minutes)
        start_str = start_date.strftime('%Y-%m-%dT%H:%M:%S.000+0000')
        exp_str = exp_date.strftime('%Y-%m-%dT%H:%M:%S.000+0000')
        
        # 3. Create TraceFlag
        values = f"TracedEntityId='{req.user_id}' DebugLevelId='{debug_level_id}' StartDate='{start_str}' ExpirationDate='{exp_str}' LogType='USER_DEBUG'"
        tf_id = await sf_service.create_record("TraceFlag", values, target_org=req.org, use_tooling_api=True)
        
        return {"id": tf_id, "message": f"Trace created successfully for {req.minutes} mins."}
    except Exception as e:
        log.error(f"Error creating trace: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/traces/{trace_id}")
async def delete_trace(trace_id: str, org: Optional[str] = None):
    """Delete a trace flag by ID."""
    try:
        await sf_service.delete_record("TraceFlag", trace_id, target_org=org, use_tooling_api=True)
        return {"message": "Trace deleted successfully"}
    except Exception as e:
        log.error(f"Error deleting trace {trace_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/logs")
async def list_logs(org: Optional[str] = None):
    """List recent Apex Logs."""
    try:
        query = "SELECT Id, Application, DurationMilliseconds, Location, LogLength, LogUserId, Operation, Request, StartTime, Status FROM ApexLog ORDER BY StartTime DESC LIMIT 100"
        logs = await sf_service.query_soql(query, target_org=org, use_tooling_api=True)
        
        # Gather Usernames
        user_ids = list(set([l['LogUserId'] for l in logs if l.get('LogUserId')]))
        user_map = {}
        if user_ids:
            ids_str = "','".join(user_ids)
            users = await sf_service.query_soql(f"SELECT Id, Name FROM User WHERE Id IN ('{ids_str}')", target_org=org, use_tooling_api=False)
            user_map = {u['Id']: u['Name'] for u in users}
            
        for log_record in logs:
            log_record['LogUserName'] = user_map.get(log_record['LogUserId'], 'Unknown')
            
        return {"logs": logs}
    except Exception as e:
        log.error(f"Error listing apex logs: {e}")
        raise HTTPException(status_code=500, detail=str(e))

class DeleteLogsRequest(BaseModel):
    log_ids: List[str]
    org: Optional[str] = None

@app.post("/api/logs/delete")
async def delete_logs(req: DeleteLogsRequest):
    """Delete multiple Apex Logs."""
    try:
        if not req.log_ids:
            return {"deleted": 0}
        await sf_service.delete_records_bulk("ApexLog", req.log_ids, target_org=req.org, use_tooling_api=True)
        return {"deleted": len(req.log_ids)}
    except Exception as e:
        log.error(f"Error deleting apex logs: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/logs/{log_id}/download")
async def download_log(log_id: str, org: Optional[str] = None):
    """Download an Apex log to the local `.logs` directory."""
    try:
        os.makedirs(".logs", exist_ok=True)
        file_path = await sf_service.get_apex_log(log_id, ".logs", target_org=org)
        return {"status": "success", "file": file_path}
    except Exception as e:
        log.error(f"Error downloading log {log_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/logs/search")
async def search_logs(q: str):
    """Global search across fetched logs in .logs directory."""
    try:
        results = parser.global_search(q, ".logs")
        return {"results": results}
    except Exception as e:
        log.error(f"Error searching logs: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/logs/{log_id}/analyze")
async def analyze_log_endpoint(log_id: str):
    """Analyze a single log file."""
    try:
        results = parser.analyze_log(log_id, ".logs")
        return results
    except Exception as e:
        log.error(f"Error analyzing log {log_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/logs/{log_id}/raw")
async def get_raw_log(log_id: str):
    """Get raw text content of a downloaded log."""
    try:
        content = sf_service.read_log(log_id, ".logs")
        return {"content": content}
    except Exception as e:
        log.error(f"Error reading raw log {log_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    port = find_open_port(start_port=8000)
    log.info(f"Starting server on port {port}")
    uvicorn.run("main:app", host="127.0.0.1", port=port, reload=True)
