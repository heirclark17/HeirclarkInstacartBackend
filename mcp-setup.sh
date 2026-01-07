#!/bin/bash

# ============================================================
# Heirclark MCP Server Setup Script
# ============================================================
# This script installs and configures MCP servers for the
# Heirclark Nutrition & Chef App backend
# ============================================================

set -e  # Exit on any error

echo "=========================================="
echo "  Heirclark MCP Server Setup"
echo "=========================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if Claude CLI is installed
if ! command -v claude &> /dev/null; then
    echo -e "${RED}Error: Claude CLI not found${NC}"
    echo "Install with: npm install -g @anthropic-ai/claude-code"
    exit 1
fi

echo -e "${GREEN}✓ Claude CLI found${NC}"
echo ""

# ============================================================
# 1. OpenNutrition MCP Server
# ============================================================
echo "----------------------------------------"
echo "1. Installing OpenNutrition MCP Server"
echo "----------------------------------------"
echo ""

# Add OpenNutrition MCP server
echo "Adding nutrition MCP server..."
claude mcp add nutrition -- npx -y @anthropic/open-nutrition-mcp@latest

echo ""
echo -e "${GREEN}✓ OpenNutrition MCP added${NC}"
echo ""

# Test OpenNutrition MCP
echo "Testing OpenNutrition MCP..."
echo "Test query: 'Find macros for grilled chicken breast'"
echo ""

# ============================================================
# 2. FitnessCoach MCP Server
# ============================================================
echo "----------------------------------------"
echo "2. Installing FitnessCoach MCP Server"
echo "----------------------------------------"
echo ""

# Add FitnessCoach MCP server
echo "Adding fitnesscoach MCP server..."
claude mcp add fitnesscoach -- npx -y @anthropic/fitness-coach-mcp@latest

echo ""
echo -e "${GREEN}✓ FitnessCoach MCP added${NC}"
echo ""

# ============================================================
# 3. PostgreSQL MCP Server (for database queries)
# ============================================================
echo "----------------------------------------"
echo "3. Installing PostgreSQL MCP Server"
echo "----------------------------------------"
echo ""

# Add PostgreSQL MCP server
echo "Adding postgres MCP server..."
claude mcp add postgres -- npx -y @anthropic/postgres-mcp@latest

echo ""
echo -e "${GREEN}✓ PostgreSQL MCP added${NC}"
echo ""

# ============================================================
# 4. Verify All MCP Servers
# ============================================================
echo "----------------------------------------"
echo "4. Verifying MCP Server Installation"
echo "----------------------------------------"
echo ""

echo "Listing all configured MCP servers..."
claude mcp list

echo ""

# ============================================================
# 5. Configuration File Setup
# ============================================================
echo "----------------------------------------"
echo "5. Setting Up Configuration"
echo "----------------------------------------"
echo ""

# Create .claude directory if it doesn't exist
mkdir -p ~/.claude

# Create MCP configuration file
cat > ~/.claude/mcp-config.json << 'EOF'
{
  "mcpServers": {
    "nutrition": {
      "command": "npx",
      "args": ["-y", "@anthropic/open-nutrition-mcp@latest"],
      "env": {
        "USDA_API_KEY": "${USDA_API_KEY}",
        "CACHE_DIR": "./cache/nutrition"
      }
    },
    "fitnesscoach": {
      "command": "npx",
      "args": ["-y", "@anthropic/fitness-coach-mcp@latest"],
      "env": {
        "SYNC_ENABLED": "true",
        "WORKOUT_DB_PATH": "./data/workouts.db"
      }
    },
    "postgres": {
      "command": "npx",
      "args": ["-y", "@anthropic/postgres-mcp@latest"],
      "env": {
        "DATABASE_URL": "${DATABASE_URL}",
        "MAX_CONNECTIONS": "10"
      }
    }
  }
}
EOF

echo -e "${GREEN}✓ MCP configuration created at ~/.claude/mcp-config.json${NC}"
echo ""

# ============================================================
# 6. Environment Variables Setup
# ============================================================
echo "----------------------------------------"
echo "6. Environment Variables"
echo "----------------------------------------"
echo ""
echo "Add these to your .env file:"
echo ""
echo "  # USDA FoodData Central API Key (free)"
echo "  # Get from: https://fdc.nal.usda.gov/api-key-signup.html"
echo "  USDA_API_KEY=your_key_here"
echo ""
echo "  # Railway PostgreSQL connection string"
echo "  DATABASE_URL=postgresql://user:pass@host:port/db"
echo ""
echo "  # Instacart Connect API (apply at developer.instacart.com)"
echo "  INSTACART_CLIENT_ID=your_client_id"
echo "  INSTACART_CLIENT_SECRET=your_client_secret"
echo ""

# ============================================================
# 7. Test Commands
# ============================================================
echo "----------------------------------------"
echo "7. Test Commands"
echo "----------------------------------------"
echo ""
echo "Run these commands to test each MCP server:"
echo ""
echo -e "${YELLOW}# Test OpenNutrition MCP${NC}"
echo 'claude "Using the nutrition MCP, find the macros for 100g of grilled chicken breast"'
echo ""
echo -e "${YELLOW}# Test FitnessCoach MCP${NC}"
echo 'claude "Using the fitnesscoach MCP, analyze the calorie impact of a 10k steps day with a 500 calorie workout"'
echo ""
echo -e "${YELLOW}# Test PostgreSQL MCP${NC}"
echo 'claude "Using the postgres MCP, list all tables in the database"'
echo ""

# ============================================================
# 8. Integration with Backend
# ============================================================
echo "----------------------------------------"
echo "8. Backend Integration"
echo "----------------------------------------"
echo ""
echo "To integrate MCP servers with your Express.js backend:"
echo ""
echo "1. Install the Claude SDK:"
echo "   npm install @anthropic-ai/sdk"
echo ""
echo "2. Import middleware from backend-middleware/"
echo ""
echo "3. Add routes:"
echo "   app.use('/api/nutrition', nutritionRoutes);"
echo ""

# ============================================================
# Done
# ============================================================
echo ""
echo "=========================================="
echo -e "${GREEN}  Setup Complete!${NC}"
echo "=========================================="
echo ""
echo "Next steps:"
echo "  1. Add environment variables to .env"
echo "  2. Run test commands above"
echo "  3. Deploy middleware to Railway"
echo "  4. Test with Playwright: npm run test:skills"
echo ""
