# Trae Project - Backend API

Express + TypeScript backend API server.

## Project Structure

```
backend/
├── src/
│   ├── config/          # Configuration files
│   ├── controllers/     # Route controllers
│   ├── middleware/      # Custom middleware
│   ├── routes/          # API routes
│   ├── services/        # Business logic
│   ├── types/           # TypeScript type definitions
│   ├── utils/           # Utility functions
│   ├── app.ts           # Express app setup
│   └── server.ts        # Server entry point
├── supabase/            # Database migrations
├── .env                 # Environment variables (not in git)
├── .env.example         # Environment variables template
├── nodemon.json         # Nodemon configuration
├── package.json         # Dependencies and scripts
└── tsconfig.json        # TypeScript configuration
```

## Prerequisites

- Node.js (v18 or higher)
- npm or yarn
- Supabase account

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create `.env` file from template:
```bash
cp .env.example .env
```

3. Configure environment variables in `.env`:
```env
PORT=3000
NODE_ENV=development
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_KEY=your_supabase_service_key
JWT_SECRET=your_jwt_secret_key
```

4. Run database migrations:
```bash
node apply-migrations.js
```

## Development

Start the development server with hot reload:
```bash
npm run dev
```

The server will run on `http://localhost:3000`.

## Production

Build the project:
```bash
npm run build
```

Start the production server:
```bash
npm start
```

## API Endpoints

### Health Check
- `GET /api/health` - Server health status

### Authentication
- `POST /api/auth/login` - User login
- `POST /api/auth/register` - User registration
- `POST /api/auth/logout` - User logout

### Dashboard
- `GET /api/dashboard` - Dashboard data

### Flows
- `GET /api/flows` - Get all flows
- `POST /api/flows` - Create new flow
- `PUT /api/flows/:id` - Update flow
- `DELETE /api/flows/:id` - Delete flow

### Contacts
- `GET /api/contacts` - Get all contacts
- `GET /api/contacts/:id` - Get contact by ID
- `POST /api/contacts` - Create contact
- `PUT /api/contacts/:id` - Update contact
- `DELETE /api/contacts/:id` - Delete contact

### Messages
- `POST /api/messages` - Send message

### Webhooks
- `POST /api/webhooks` - Webhook endpoint

### Settings
- `GET /api/settings` - Get settings
- `PUT /api/settings` - Update settings

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| PORT | Server port | No (default: 3000) |
| NODE_ENV | Environment mode | No (default: development) |
| SUPABASE_URL | Supabase project URL | Yes |
| SUPABASE_SERVICE_KEY | Supabase service key | Yes |
| JWT_SECRET | JWT signing secret | Yes |

## Scripts

- `npm run dev` - Start development server with hot reload
- `npm run build` - Build TypeScript to JavaScript
- `npm start` - Start production server
- `npm test` - Run tests (not implemented yet)

## Tech Stack

- **Runtime**: Node.js
- **Framework**: Express.js
- **Language**: TypeScript
- **Database**: Supabase (PostgreSQL)
- **Authentication**: JWT
- **Dev Tools**: Nodemon, TSX

