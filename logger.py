import logging
import socket
import sys

def setup_logger():
    # Set up basic configuration for logging
    logger = logging.getLogger("sfdc_debug_logs")
    logger.setLevel(logging.DEBUG)
    
    # Create file handler
    file_handler = logging.FileHandler("app.log", encoding="utf-8")
    file_handler.setLevel(logging.DEBUG)
    
    # Create console handler
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(logging.INFO)
    
    # Create formatter and add it to the handlers
    formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
    file_handler.setFormatter(formatter)
    console_handler.setFormatter(formatter)
    
    # Add the handlers to the logger
    logger.addHandler(file_handler)
    logger.addHandler(console_handler)
    
    return logger

log = setup_logger()

def find_open_port(start_port=8000, max_port=8100):
    """Finds an open port starting from start_port."""
    for port in range(start_port, max_port + 1):
        try:
            # Try to bind to the port
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.bind(('127.0.0.1', port))
                return port
        except socket.error:
            # Port is probably in use
            continue
    raise RuntimeError(f"Could not find an open port between {start_port} and {max_port}")

if __name__ == "__main__":
    port = find_open_port()
    log.info(f"Port {port} found available.")
