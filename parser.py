import os
import concurrent.futures
from typing import Dict, Any, List
from logger import log

def search_in_file(file_path: str, query: str) -> tuple:
    matches = []
    try:
        with open(file_path, "r", encoding="utf-8", errors="replace") as f:
            for line_no, line in enumerate(f, 1):
                if query.lower() in line.lower():
                    matches.append({"line_no": line_no, "snippet": line.strip()[:200]})
                    if len(matches) > 50:  # Cap at 50 to prevent massive payloads
                        break
    except Exception as e:
        log.error(f"Error reading file {file_path} for search: {e}")
    return os.path.basename(file_path), matches

def global_search(query: str, logs_dir: str = ".logs") -> List[Dict]:
    results = []
    if not os.path.exists(logs_dir):
        return results
    
    files = [os.path.join(logs_dir, f) for f in os.listdir(logs_dir) if f.endswith(".log")]
    if not files:
        return results
    
    seen_files = set()
    with concurrent.futures.ThreadPoolExecutor(max_workers=os.cpu_count()) as executor:
        futures = {executor.submit(search_in_file, f, query): f for f in files}
        for future in concurrent.futures.as_completed(futures):
            filename, file_matches = future.result()
            if file_matches and filename not in seen_files:
                results.append({"file": filename, "matches": file_matches})
                seen_files.add(filename)
                if len(results) >= 100: # Cap at 100 matched files
                    executor.shutdown(wait=False, cancel_futures=True)
                    break
                    
    return results

def analyze_log(log_id: str, logs_dir: str = ".logs") -> Dict[str, Any]:
    file_path = os.path.join(logs_dir, f"{log_id}.log")
    if not os.path.exists(file_path):
        # Allow passing the direct path or local file name too
        file_path_direct = os.path.join(logs_dir, log_id)
        if os.path.exists(file_path_direct):
            file_path = file_path_direct
        else:
            raise FileNotFoundError(f"Log {log_id} not found locally. Please download it first.")

    analysis = {
        "soql": [],
        "dml": [],
        "assignments": [],
        "limits": {},
        "warnings": []
    }
    
    current_soql = None
    current_dml = None
    soql_count_map = {}
    in_limits_block = False
    
    try:
        with open(file_path, "r", encoding="utf-8", errors="replace") as f:
            for line_no, line in enumerate(f, 1):
                raw_line = line.strip()
                
                # Check for limits output within a limits block
                if in_limits_block:
                    if "|" in raw_line and len(raw_line.split("|")) > 2:
                        # Probably a new event started
                        in_limits_block = False
                    else:
                        if "Number of SOQL queries:" in raw_line:
                            analysis["limits"]["soql_queries"] = raw_line.split(":", 1)[1].strip()
                        elif "Maximum CPU time:" in raw_line:
                            analysis["limits"]["cpu_time"] = raw_line.split(":", 1)[1].strip()
                        elif "Number of DML statements:" in raw_line:
                            analysis["limits"]["dml_statements"] = raw_line.split(":", 1)[1].strip()
                        elif "Number of DML rows:" in raw_line:
                            analysis["limits"]["dml_rows"] = raw_line.split(":", 1)[1].strip()
                        continue
                
                parts = raw_line.split('|')
                if len(parts) < 2:
                    continue
                
                timestamp = parts[0]
                event = parts[1]
                
                if event == "LIMIT_USAGE_FOR_NS":
                    in_limits_block = True
                    
                elif event == "VARIABLE_ASSIGNMENT":
                    if len(parts) >= 5:
                        analysis["assignments"].append({
                            "time": timestamp,
                            "line": line_no,
                            "variable": parts[3],
                            "value": parts[4]
                        })
                        
                elif event == "DML_BEGIN":
                    if len(parts) >= 6:
                        current_dml = {
                            "time": timestamp,
                            "line": line_no,
                            "op": parts[3],
                            "object": parts[4],
                            "rows": parts[5]
                        }
                        
                elif event == "DML_END":
                    if current_dml:
                        analysis["dml"].append(current_dml)
                        current_dml = None
                        
                elif event == "SOQL_EXECUTE_BEGIN":
                    if len(parts) >= 5:
                        query_str = parts[4]
                        if len(parts) > 5:
                            query_str = "|".join(parts[4:]) # Rejoin if query had pipes
                        current_soql = {
                            "time": timestamp,
                            "line": line_no,
                            "query": query_str.strip(),
                            "rows": 0
                        }
                        
                elif event == "SOQL_EXECUTE_END":
                    if current_soql and len(parts) >= 4:
                        row_str = parts[3].replace("Rows:", "")
                        try:
                            current_soql["rows"] = int(row_str)
                        except ValueError:
                            pass
                        
                        q_str = current_soql["query"]
                        if q_str in soql_count_map:
                            soql_count_map[q_str] += 1
                            if soql_count_map[q_str] == 2:
                                analysis["warnings"].append(f"Duplicate SOQL executed: {q_str[:100]}...")
                        else:
                            soql_count_map[q_str] = 1
                            
                        analysis["soql"].append(current_soql)
                        current_soql = None
                        
    except Exception as e:
        log.error(f"Error analyzing log {file_path}: {e}")
        
    analysis["total_soql"] = sum([1 for q in analysis["soql"]])
    analysis["total_soql_rows"] = sum([q["rows"] for q in analysis["soql"]])
    return analysis
