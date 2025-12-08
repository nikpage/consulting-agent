#!/usr/bin/env python3
import os

SKIP = {"node_modules", ".git", ".next", ".vercel", "__pycache__"}

def describe(filename, path):
    name = filename.lower()

    # Config files
    if name == ".env" or name == ".env.local":
        return "Environment variables (passwords, API keys)"
    if name == ".gitignore":
        return "Files Git should ignore"
    if name == ".gitattributes":
        return "Git file handling settings"
    if name == "package.json":
        return "Project dependencies and scripts"
    if name == "package-lock.json":
        return "Locked dependency versions"
    if name == "tsconfig.json":
        return "TypeScript settings"
    if name == "next.config.js":
        return "Next.js framework settings"
    if name == "vercel.json":
        return "Vercel deployment settings (cron jobs, routes)"
    if name == "next-env.d.ts":
        return "Next.js TypeScript definitions (auto-generated)"

    # Documentation
    if name == "readme.md":
        return "Project documentation"
    if name == "deployment.md":
        return "Deployment instructions"

    # Database
    if "sql" in name:
        return "Database setup/queries"
    if "seed" in name:
        return "Fills database with test data"
    if "clean-db" in name:
        return "Clears database"
    if "verify-db" in name:
        return "Checks database is working"
    if "supabase" in name:
        return "Database connection"

    # Auth
    if "auth" in name or "google-auth" in name:
        return "Google login/authentication"
    if "callback" in name:
        return "Handles OAuth redirect after login"
    if "url.js" in name:
        return "Generates login URL"

    # Core features
    if "calendar" in name:
        return "Google Calendar integration"
    if "classification" in name:
        return "Sorts/categorizes emails using AI"
    if "embeddings" in name:
        return "Converts text to AI-searchable format"
    if "scheduling" in name:
        return "Books meetings/appointments"
    if "threading" in name:
        return "Groups related emails together"
    if "ingestion" in name or "ingest" in name:
        return "Pulls in emails/data for processing"
    if "morning-brief" in name or "daily-brief" in name:
        return "Sends daily summary email"
    if "security" in name:
        return "Security helpers (encryption, signing)"

    # Agent logic
    if "logic" in name:
        return "Main sales agent brain"
    if "commands" in name:
        return "Agent actions/commands"
    if "conflict" in name:
        return "Handles scheduling conflicts"

    # Pages
    if name == "index.js" and "pages" in path:
        return "Homepage"
    if name == "index.ts" and "pages" not in path:
        return "Main entry point"

    # Utilities
    if "setup" in name:
        return "Initial setup script"
    if "test" in name:
        return "Testing script"
    if name.endswith(".bak"):
        return "Backup file"

    return "Code file"

def walk(path, indent=0):
    items = sorted(os.listdir(path))
    for item in items:
        full = os.path.join(path, item)
        if os.path.isdir(full):
            if item in SKIP:
                continue
            print("  " * indent + f"📁 {item}/")
            walk(full, indent + 1)
        else:
            desc = describe(item, full)
            print("  " * indent + f"📄 {item} → {desc}")

if __name__ == "__main__":
    print("Project Overview\n")
    walk(".")
