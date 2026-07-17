FROM python:3.11-slim
WORKDIR /app

# Install requirements
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy source code
COPY . .

EXPOSE 8000

ENV ML_PORT=8000

CMD ["python", "server.py"]
