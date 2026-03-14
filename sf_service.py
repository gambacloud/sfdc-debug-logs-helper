import subprocess
import json
import asyncio
from logger import log

class SalesforceCLIError(Exception):
    pass

async def run_sf_command(cmd_args: list[str]) -> dict:
    """Run an SF CLI command using a threaded subprocess and robust path detection."""
    full_cmd = ["sf"] + cmd_args + ["--json"]
    command_str = subprocess.list2cmdline(full_cmd)
    log.debug(f"Executing SF CLI command: {command_str}")
    
    def _run():
        import os
        env = os.environ.copy()
        # Ensure common SF installation paths are included
        sf_paths = [
            r"C:\Program Files\sf\bin",
            r"C:\Program Files\sfdx\bin",
            r"C:\Users\idane\AppData\Local\sfdx\client\bin" # Common user-local install
        ]
        current_path = env.get("PATH", "")
        for p in sf_paths:
            if p not in current_path and os.path.exists(p):
                current_path = p + os.pathsep + current_path
        env["PATH"] = current_path

        return subprocess.run(
            command_str,
            shell=True, # Required on Windows to resolve sf.cmd correctly
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding='utf-8',
            errors='replace',
            env=env
        )

    try:
        # Run in a separate thread to keep the event loop responsive
        loop = asyncio.get_event_loop()
        process = await loop.run_in_executor(None, _run)
    except FileNotFoundError:
        log.error("Salesforce CLI ('sf') not found on system PATH.")
        raise SalesforceCLIError("Salesforce CLI ('sf') is not installed or not available on the system PATH.")
    except Exception as e:
        log.error(f"Unexpected error running SF CLI: {str(e)}")
        raise SalesforceCLIError(f"Unexpected error running SF CLI: {str(e)}")

    if process.stdout:
        try:
            result = json.loads(process.stdout)
            if result.get('status') == 0:
                return result.get('result', {})
            else:
                error_msg = result.get('message', 'Unknown SF CLI Error')
                log.error(f"SF CLI command failed with status {result.get('status')}: {error_msg}")
                raise SalesforceCLIError(error_msg)
        except json.JSONDecodeError:
            log.error(f"Failed to parse JSON from stdout: {process.stdout[:200]}")
            raise SalesforceCLIError("Invalid JSON response from SF CLI")
    
    if process.stderr:
        log.error(f"SF CLI stderr: {process.stderr}")
        raise SalesforceCLIError(process.stderr)

    raise SalesforceCLIError("No output received from SF CLI")

async def query_soql(query: str, target_org: str = None, use_tooling_api: bool = False) -> list[dict]:
    """Execute a SOQL query using the SF CLI."""
    args = ["data", "query", "-q", query]
    if use_tooling_api:
        args.append("-t")
    if target_org:
        args.extend(["-o", target_org])
    
    result = await run_sf_command(args)
    return result.get('records', [])

async def create_record(sobject: str, values: str, target_org: str = None, use_tooling_api: bool = False) -> str:
    """Create a record and return its ID. values should be in 'Name=Value Name2=Value2' format."""
    args = ["data", "create", "record", "-s", sobject, "-v", values]
    if use_tooling_api:
        args.append("-t")
    if target_org:
        args.extend(["-o", target_org])
    
    result = await run_sf_command(args)
    return result.get('id')

async def delete_record(sobject: str, record_id: str, target_org: str = None, use_tooling_api: bool = False) -> bool:
    """Delete a record by ID."""
    args = ["data", "delete", "record", "-s", sobject, "-i", record_id]
    if use_tooling_api:
        args.append("-t")
    if target_org:
        args.extend(["-o", target_org])
    
    await run_sf_command(args)
    return True

async def delete_records_bulk(sobject: str, record_ids: list[str], target_org: str = None, use_tooling_api: bool = False) -> bool:
    """Delete multiple records by ID (iterative since sf data delete doesn't easily support lists directly)."""
    # For large volumes, we'd use sf data delete bulk, but for debug logs, iterating or chunking is ok.
    # We will do them concurrently using asyncio.gather for speed.
    tasks = [delete_record(sobject, r_id, target_org, use_tooling_api) for r_id in record_ids]
    await asyncio.gather(*tasks)
    return True

async def get_apex_log(log_id: str, output_dir: str, target_org: str = None) -> str:
    """Download an Apex Log and return its file path."""
    args = ["apex", "get", "log", "-i", log_id, "-d", output_dir]
    if target_org:
        args.extend(["-o", target_org])
    try:
        result = await run_sf_command(args)
        # Should return list of files downloaded
        return f"{output_dir}/{log_id}.log"
    except SalesforceCLIError as e:
        log.error(f"Failed to get log {log_id}: {e}")
        raise

def read_log(log_id: str, output_dir: str) -> str:
    """Read raw log content from the local directory."""
    import os
    file_path = os.path.join(output_dir, f"{log_id}.log")
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"Log file {log_id}.log not found locally.")
    
    with open(file_path, "r", encoding="utf-8", errors="replace") as f:
        return f.read()
