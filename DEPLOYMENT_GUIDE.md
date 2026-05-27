# SRE Cloud & Bare-Metal Deployment Guide 🚀

This guide explains how to package, deploy, and scale the **Coral AI Bot** SRE Incident Response platform to **AWS, GCP, Azure, Kubernetes, or Bare-Metal Linux servers** using our standardized, optimized production Docker container.

---

## 1. Local Container Verification (Docker)

To verify that the container compiles and launches correctly on your local machine:

```bash
# 1. Build the Docker image
docker build -t coral-sre-agent:latest .

# 2. Run the container, mapping the frontend (3000) and backend (3001) ports
docker run -p 3000:3000 -p 3001:3001 coral-sre-agent:latest
```

The app will be fully self-contained, register all Coral schemas automatically, and run successfully at `http://localhost:3000`.

---

## 2. Deploying to AWS (Amazon Web Services)

AWS provides two excellent serverless options for this container:

### Option A: Serverless via AWS App Runner (Recommended)
AWS App Runner is the fastest way to run containerized web applications.
1. Push your built image to **Amazon ECR (Elastic Container Registry)**.
2. Go to **AWS App Runner Console** -> **Create Service**.
3. Select **Container registry** -> **Amazon ECR**, and choose the `coral-sre-agent` image.
4. Set the **Port** configuration to `3000`. App Runner handles internal proxy routing and HTTPS certificates automatically!

### Option B: Enterprise via Amazon ECS (Fargate) & ALB
For highly secure corporate virtual private networks (VPCs):
1. Create an **ECS Task Definition** utilizing **AWS Fargate** (serverless compute).
2. Declare two container mappings in the task:
   - **Client**: Port `3000` (mapped to Application Load Balancer).
   - **Server**: Port `3001` (internal backend API).
3. Connect the ECS Service to an **Application Load Balancer (ALB)** to manage routing and expose the SRE Dashboard to your engineering subnet.

---

## 3. Deploying to GCP (Google Cloud Platform)

GCP excels at running serverless SRE containers.

### Option A: Serverless via Google Cloud Run (Recommended)
Google Cloud Run automatically scales the SRE Bot from zero to production load.
1. Authenticate and push your image to **Google Artifact Registry**:
   ```bash
   docker tag coral-sre-agent:latest gcr.io/your-project-id/coral-sre-agent:latest
   docker push gcr.io/your-project-id/coral-sre-agent:latest
   ```
2. Deploy the container in a single shell command:
   ```bash
   gcloud run deploy coral-sre-agent \
     --image gcr.io/your-project-id/coral-sre-agent:latest \
     --port 3000 \
     --platform managed \
     --allow-unauthenticated
   ```

### Option B: Scalable via Google Kubernetes Engine (GKE)
If your SRE teams run on Kubernetes, you can easily deploy via the GKE deployment specifications (see Section 5 below).

---

## 4. Deploying to Azure (Microsoft Azure)

Azure provides robust corporate options for secure SRE console hosting.

### Option A: Azure Container Apps (Recommended)
The easiest serverless container host in Azure:
1. Push your built image to **Azure Container Registry (ACR)**.
2. Run the deployment via Azure CLI:
   ```bash
   az containerapp create \
     --name coral-sre-agent \
     --resource-group SreResourceGroup \
     --environment SreEnv \
     --image yourregistry.azurecr.io/coral-sre-agent:latest \
     --target-port 3000 \
     --ingress external
   ```

### Option B: Azure Kubernetes Service (AKS)
For massive clusters, package the app under the standard Helm chart and deploy directly to AKS.

---

## 5. Kubernetes Orchestration (Any Cloud / Bare-Metal)

Save the following manifest as `sre-agent-deployment.yaml` to deploy the platform to any **EKS, GKE, AKS, or bare-metal Kubernetes (k3s/microk8s)** cluster:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: coral-sre-agent
  labels:
    app: coral-sre-agent
spec:
  replicas: 1
  selector:
    matchLabels:
      app: coral-sre-agent
  template:
    metadata:
      labels:
        app: coral-sre-agent
    spec:
      containers:
        - name: sre-platform
          image: yourregistry/coral-sre-agent:latest
          ports:
            - containerPort: 3000
              name: frontend
            - containerPort: 3001
              name: backend
          resources:
            limits:
              cpu: "1000m"
              memory: "1024Mi"
            requests:
              cpu: "500m"
              memory: "512Mi"
---
apiVersion: v1
kind: Service
metadata:
  name: coral-sre-agent-service
spec:
  type: ClusterIP
  ports:
    - port: 80
      targetPort: 3000
      name: http
  selector:
    app: coral-sre-agent
```

---

## 6. Deploying to Bare Metal (Linux VM / Physical Server)

If you are deploying directly to a physical bare-metal Linux server running **Ubuntu, Debian, RedHat, or Rocky Linux**:

### Step 1: Install Docker
```bash
sudo apt-get update
sudo apt-get install -y docker.io
sudo systemctl enable --now docker
```

### Step 2: Set up Systemd Services (Alternative to Docker)
If you prefer to run bare-metal without containerization:
1. Install **Node.js 18+**, **pnpm**, and the **Coral CLI** directly on the host:
   ```bash
   curl -fsSL https://withcoral.com/install.sh | sh
   npm install -g pnpm
   ```
2. Clone the code, compile, and configure a simple Systemd unit file `/etc/systemd/system/sre-bot.service`:
   ```ini
   [Unit]
   Description=Coral SRE Agent Platform
   After=network.target

   [Service]
   Type=simple
   User=sre-admin
   WorkingDirectory=/home/sre-admin/coral-sre-agent
   ExecStart=/usr/bin/pnpm run dev
   Restart=always
   Environment=NODE_ENV=production PORT=3001

   [Install]
   WantedBy=multi-user.target
   ```
3. Enable and launch the service:
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable --now sre-bot
   ```
