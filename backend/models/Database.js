const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DATA_DIR = path.join(__dirname, '../data');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

class Database {
  static getFilePath(collection) {
    return path.join(DATA_DIR, `${collection}.json`);
  }

  static readData(collection) {
    const filePath = this.getFilePath(collection);
    try {
      if (fs.existsSync(filePath)) {
        const data = fs.readFileSync(filePath, 'utf-8');
        return JSON.parse(data);
      }
      return [];
    } catch (error) {
      console.error(`Error reading ${collection}:`, error);
      return [];
    }
  }

  static writeData(collection, data) {
    const filePath = this.getFilePath(collection);
    try {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
      return true;
    } catch (error) {
      console.error(`Error writing ${collection}:`, error);
      return false;
    }
  }

  static create(collection, item) {
    const data = this.readData(collection);
    item.id = uuidv4();
    item.createdAt = new Date().toISOString();
    data.push(item);
    this.writeData(collection, data);
    return item;
  }

  static read(collection, id) {
    const data = this.readData(collection);
    return data.find(item => item.id === id);
  }

  static readAll(collection) {
    return this.readData(collection);
  }

  static update(collection, id, updates) {
    const data = this.readData(collection);
    const index = data.findIndex(item => item.id === id);
    if (index === -1) return null;
    
    data[index] = { ...data[index], ...updates, updatedAt: new Date().toISOString() };
    this.writeData(collection, data);
    return data[index];
  }

  static delete(collection, id) {
    const data = this.readData(collection);
    const filtered = data.filter(item => item.id !== id);
    this.writeData(collection, filtered);
    return true;
  }

  static findBy(collection, field, value) {
    const data = this.readData(collection);
    return data.find(item => item[field] === value);
  }

  static filterBy(collection, field, value) {
    const data = this.readData(collection);
    return data.filter(item => item[field] === value);
  }
}

module.exports = Database;
