FROM python:3.11-slim

WORKDIR /app

# Install system dependencies if needed (e.g. for cryptography)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install dependencies
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend requirements if any
COPY server/requirements.txt ./server-requirements.txt
RUN pip install --no-cache-dir -r server-requirements.txt

# Copy application code
COPY . .

# Expose port
EXPOSE 8000

# Run FastAPI app
CMD ["python", "server/run.py"]
