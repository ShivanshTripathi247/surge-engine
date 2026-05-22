FROM python:3.12-slim
WORKDIR /app
RUN pip install --no-cache-dir sentence-transformers==3.0.1 psycopg2-binary pgvector tqdm
COPY embed_server.py main.py ./
# Warm the model into the image layer to avoid first-boot download.
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('all-MiniLM-L6-v2')"
ENV EMBED_PORT=5001
EXPOSE 5001
CMD ["python", "embed_server.py"]
