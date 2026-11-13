const fs = require('fs');
const path = require('path');

class StockResolver {
  constructor() {
    this.symbolToCompany = new Map();
    this.companyToSymbol = new Map();
    this.companyList = [];
    this.isLoaded = false;
  }

  loadCsv(filePath = path.join(__dirname, '../data/EQUITY_L.csv')) {
    try {
      if (!fs.existsSync(filePath)) {
        console.warn(`[StockResolver] CSV file not found at ${filePath}, using dynamic matching only.`);
        return;
      }

      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.split('\n');

      // Header: SYMBOL,NAME OF COMPANY, SERIES, DATE OF LISTING, PAID UP VALUE, MARKET LOT, ISIN NUMBER, FACE VALUE
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        // Parse CSV line taking care of possible quotes
        const parts = line.split(',');
        if (parts.length >= 2) {
          const symbol = parts[0].trim().toUpperCase();
          const companyName = parts[1].trim();

          if (symbol && companyName) {
            this.symbolToCompany.set(symbol, companyName);
            this.companyToSymbol.set(companyName.toLowerCase(), symbol);
            this.companyList.push({ symbol, companyName });
          }
        }
      }

      this.isLoaded = true;
      console.log(`[StockResolver] Loaded ${this.symbolToCompany.size} stock mappings from NSE equity list.`);
    } catch (err) {
      console.error('[StockResolver] Failed to load equity CSV:', err.message);
    }
  }

  /**
   * Resolve a stock input (symbol or partial company name) to standard info.
   */
  resolve(input) {
    if (!input || typeof input !== 'string') return null;
    const cleanInput = input.trim();
    const upper = cleanInput.toUpperCase();
    const lower = cleanInput.toLowerCase();

    // 1. Direct symbol match
    if (this.symbolToCompany.has(upper)) {
      return {
        symbol: upper,
        companyName: this.symbolToCompany.get(upper),
        input: cleanInput,
        matchedBy: 'symbol'
      };
    }

    // 2. Direct company match
    if (this.companyToSymbol.has(lower)) {
      const sym = this.companyToSymbol.get(lower);
      return {
        symbol: sym,
        companyName: this.symbolToCompany.get(sym) || cleanInput,
        input: cleanInput,
        matchedBy: 'exact_name'
      };
    }

    // 3. Substring match against company names
    for (const item of this.companyList) {
      if (item.companyName.toLowerCase().includes(lower)) {
        return {
          symbol: item.symbol,
          companyName: item.companyName,
          input: cleanInput,
          matchedBy: 'company_substring'
        };
      }
    }

    // Fallback: return as-is
    return {
      symbol: upper,
      companyName: cleanInput,
      input: cleanInput,
      matchedBy: 'custom_keyword'
    };
  }

  /**
   * Check if a news item / title matches a monitored stock item
   */
  matches(stockEntry, title, description = '') {
    const textToSearch = `${title} ${description}`.toLowerCase();
    const searchTokens = [];

    if (stockEntry.symbol) {
      searchTokens.push(stockEntry.symbol.toLowerCase());
    }
    if (stockEntry.companyName) {
      searchTokens.push(stockEntry.companyName.toLowerCase());
      // Also remove " limited" or " ltd" for broader company name match
      const simplified = stockEntry.companyName
        .toLowerCase()
        .replace(/\blimited\b/g, '')
        .replace(/\bltd\.?\b/g, '')
        .trim();
      if (simplified.length > 2) {
        searchTokens.push(simplified);
      }
    }
    if (stockEntry.input) {
      searchTokens.push(stockEntry.input.toLowerCase());
    }

    // Check if any token matches
    for (const token of searchTokens) {
      if (!token || token.length < 2) continue;

      // Word boundary regex for short symbols to avoid false positives (e.g. 'MRF', 'ITC', 'LT')
      if (token.length <= 4) {
        const regex = new RegExp(`\\b${escapeRegExp(token)}\\b`, 'i');
        if (regex.test(textToSearch)) {
          return { matched: true, matchedToken: token };
        }
      } else {
        if (textToSearch.includes(token)) {
          return { matched: true, matchedToken: token };
        }
      }
    }

    return { matched: false };
  }
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = new StockResolver();
