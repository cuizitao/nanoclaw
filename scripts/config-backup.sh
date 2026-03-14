#!/bin/bash
# NanoClaw Configuration Backup and Restore Tool
# Simple wrapper for config-backup.js

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_ROOT" || exit 1

case "${1:-status}" in
  backup)
    echo "Creating configuration backup..."
    node scripts/config-backup.js backup
    ;;
  restore)
    if [ -n "$2" ]; then
      node scripts/config-backup.js restore "$2"
    else
      node scripts/config-backup.js restore
    fi
    ;;
  verify)
    echo "Verifying configuration..."
    node scripts/config-backup.js verify
    ;;
  sync)
    echo "Syncing environment to container..."
    node scripts/config-backup.js sync
    ;;
  list)
    node scripts/config-backup.js list
    ;;
  status)
    node scripts/config-backup.js status
    ;;
  *)
    echo "NanoClaw Configuration Backup Tool"
    echo ""
    echo "Usage: ./scripts/config-backup.sh <command>"
    echo ""
    echo "Commands:"
    echo "  backup   - Create configuration backup"
    echo "  restore  - Restore from backup (default: latest)"
    echo "  verify   - Verify current configuration"
    echo "  sync     - Sync .env to container environment"
    echo "  list     - List available backups"
    echo "  status   - Show configuration status"
    echo ""
    echo "Examples:"
    echo "  ./scripts/config-backup.sh backup"
    echo "  ./scripts/config-backup.sh restore"
    echo "  ./scripts/config-backup.sh verify"
    exit 1
    ;;
esac
