import 'dotenv/config';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '../config/db.js';
import User from '../models/User.js';
import Title from '../models/Title.js';
import WatchSpace from '../models/WatchSpace.js';
import ChatMessage from '../models/ChatMessage.js';
import Interaction from '../models/Interaction.js';
import { titles, users } from './data.js';

async function seed() {
  await connectDB(process.env.MONGO_URI);
  await Promise.all([
    User.deleteMany({}),
    Title.deleteMany({}),
    WatchSpace.deleteMany({}),
    ChatMessage.deleteMany({}),
    Interaction.deleteMany({}),
  ]);

  const createdUsers = [];
  for (const u of users) {
    const doc = await User.create({
      email: u.email,
      displayName: u.displayName,
      passwordHash: await bcrypt.hash(u.password, 12),
      role: u.role,
      preferences: u.preferences,
    });
    createdUsers.push(doc);
  }

  const createdTitles = await Title.insertMany(titles);

  console.log('StreamSync seeded.');
  console.log(`  ${createdUsers.length} users, ${createdTitles.length} titles (${createdTitles.map((t) => t.timeline.length).reduce((a, b) => a + b, 0)} timeline events total)`);
  console.table(users.map(({ email, password, role }) => ({ email, password, role })));
}

seed()
  .then(disconnectDB)
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
