import os

bind = "0.0.0.0:" + os.environ.get("PORT", "8080")
workers = 1
worker_class = "gthread"
threads = 4
timeout = 60
graceful_timeout = 25
keepalive = 5
limit_request_line = 4094
limit_request_fields = 100
limit_request_field_size = 8190
accesslog = None  # Never log address/PNU query strings.
errorlog = "-"
capture_output = False
