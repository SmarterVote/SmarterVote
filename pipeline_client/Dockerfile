FROM python:3.14-slim@sha256:51dafde81dbdb6ebde285137a295cf18a47ca95234fe388a343719cb97305b3d

# Set working directory
WORKDIR /app

# Install system dependencies, plus security updates the digest pin would
# otherwise freeze out
RUN apt-get update && apt-get upgrade -y && apt-get install -y \
    gcc \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first for better caching
COPY pipeline_client/backend/requirements.txt /tmp/requirements.txt

# Install Python dependencies
RUN pip install --no-cache-dir -r /tmp/requirements.txt \
    && pip install --no-cache-dir python-dotenv

# Copy application code
COPY pipeline_client ./pipeline_client
COPY pipeline_client/run.py ./run.py
COPY shared ./shared

# Create non-root user
RUN useradd --create-home --shell /bin/bash app \
    && chown -R app:app /app
USER app

# Environment variables
ENV PYTHONPATH=/app
ENV PYTHONUNBUFFERED=1

EXPOSE 8001

# Run the pipeline client
ENTRYPOINT ["python", "run.py"]
