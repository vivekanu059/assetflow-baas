# AssetFlow BaaS (Backend-as-a-Service)

![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![Express](https://img.shields.io/badge/Express.js-000000?style=for-the-badge&logo=express&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-316192?style=for-the-badge&logo=postgresql&logoColor=white)
![MongoDB](https://img.shields.io/badge/MongoDB-4EA94B?style=for-the-badge&logo=mongodb&logoColor=white)
![Redis](https://img.shields.io/badge/Redis-DC382D?style=for-the-badge&logo=redis&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2CA5E0?style=for-the-badge&logo=docker&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js-000000?style=for-the-badge&logo=nextdotjs&logoColor=white)

An enterprise-grade, event-driven document processing pipeline and API Gateway. AssetFlow is designed to ingest massive media files, queue them securely, and process them asynchronously using distributed worker nodes, completely decoupled from the main API thread.

## 🚀 System Architecture



The system follows a strict Microservice and CQRS-inspired pattern:
1. **Client Request:** User requests a cryptographically signed upload URL from the API Gateway.
2. **Direct-to-Storage:** Client uploads the raw asset directly to **MinIO (S3)**, bypassing the Node.js server to save bandwidth and memory.
3. **Event Emitted:** Client hits the `/finalize` endpoint. The API Gateway updates **PostgreSQL** (status: `PROCESSING`) and pushes a job payload to **Redis**.
4. **Asynchronous Processing:** A decoupled Node.js Background Worker pops the job from Redis, downloads the asset from MinIO, and processes it (e.g., OCR extraction).
5. **Data Lake Storage:** Massive, unstructured extracted data is saved to **MongoDB**.
6. **Webhook Push:** A secondary worker fires a webhook back to the user's external system with the final payload.

## 🛠 Tech Stack

* **API Gateway:** Node.js, Express, Prisma ORM
* **Frontend Dashboard:** Next.js (App Router), TailwindCSS, Framer Motion
* **Message Broker:** Redis (List-based Job Queues & Pub/Sub)
* **Relational Database:** PostgreSQL (Users, API Keys, Asset Metadata)
* **NoSQL Database:** MongoDB (Unstructured Extracted Payloads, Dead Letter Queue Logs)
* **Object Storage:** MinIO (S3-Compatible)
* **Infrastructure:** Docker & Docker Compose

## 🔒 Enterprise Security Features

* **Cryptographic API Keys:** API keys are generated using cryptographically secure random bytes and hashed using `SHA-256` before hitting PostgreSQL. If the DB leaks, client keys remain safe.
* **AWS V4 Signatures:** Uses offline region-locked hashing to generate pre-signed upload URLs, ensuring malicious actors cannot tamper with storage buckets.
* **Rate Limiting:** Redis-backed sliding-window rate limiters prevent API abuse and DDoS attacks.
* **Fault Tolerance (DLQ):** Failed webhook deliveries are automatically retried with exponential backoff before being routed to a MongoDB Dead Letter Queue for manual review.

## ⚡ Quick Start (Infrastructure as Code)

You do not need to install Postgres, Mongo, Redis, or Minio on your machine. The entire 7-piece architecture is containerized.

**1. Clone the repository**
```bash
git clone [https://github.com/yourusername/assetflow-baas.git](https://github.com/yourusername/assetflow-baas.git)
cd assetflow-baas

