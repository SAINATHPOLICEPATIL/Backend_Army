# MAMS Backend (Military Asset Management System)

Node.js & Express REST API for the Military Asset Management System (MAMS).

## Features
- **RESTful Architecture**: Clean endpoints for Dashboard metrics, Purchases, Transfers, Assignments, Expenditures, and Stock Levels.
- **Role-Based Access Control (RBAC)**: Enforced via Express middleware (`admin`, `base_commander`, `logistics_officer`).
- **Base Scoping**: Base commanders can only view and operate on data scoped to their assigned base.
- **Append-Only Audit Logs**: Every critical API call and asset state transition is securely logged.
- **Security Hardening**: Includes `helmet` headers, strict CSP, JWT validation, and IP rate limiting.

## Prerequisites
- Node.js 18+
- MySQL 8.0+

## Setup & Running

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Configure Environment Variables**:
   Copy `.env.example` to `.env` and fill in your MySQL credentials:
   ```bash
   cp .env.example .env   # Or 'copy .env.example .env' in Windows CMD
   ```

3. **Initialize Database**:
   ```bash
   npm run db:setup
   ```

4. **Start the API Server**:
   ```bash
   npm start
   ```
   API runs at `http://localhost:4000`.

5. **Run Verification / E2E Tests**:
   ```bash
   npm test
   ```
