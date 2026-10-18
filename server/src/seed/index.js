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

// Watch history that gives the hybrid recommender real training signal:
// each demo viewer has a distinct profile, so their rails must differ.
const demoInteractions = [
  { user: 'ana@streamsync.dev', title: 'Big Buck Bunny', watched: 596, completed: true, rating: 4.5, daysAgo: 6, co: ['host@streamsync.dev', 'mei@streamsync.dev'] },
  { user: 'ana@streamsync.dev', title: 'Elephants Dream', watched: 240, completed: false, rating: 3.0, daysAgo: 3, co: ['ravi@streamsync.dev'] },
  { user: 'ravi@streamsync.dev', title: 'Elephants Dream', watched: 512, completed: true, rating: 4.5, daysAgo: 5, co: ['ana@streamsync.dev'] },
  { user: 'ravi@streamsync.dev', title: 'Sintel', watched: 300, completed: false, rating: 4.0, daysAgo: 2, co: ['mei@streamsync.dev'] },
  { user: 'mei@streamsync.dev', title: 'Sintel', watched: 652, completed: true, rating: 4.5, daysAgo: 4, co: ['ravi@streamsync.dev'] },
  { user: 'mei@streamsync.dev', title: 'Big Buck Bunny', watched: 120, completed: false, rating: 2.0, daysAgo: 1, co: ['ana@streamsync.dev', 'host@streamsync.dev'] },
  { user: 'host@streamsync.dev', title: 'Big Buck Bunny', watched: 596, completed: true, rating: 4.0, daysAgo: 7, co: ['ana@streamsync.dev', 'mei@streamsync.dev'] },
  { user: 'host@streamsync.dev', title: 'Elephants Dream', watched: 200, completed: false, rating: 3.5, daysAgo: 2, co: [] },
];

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

  const userByEmail = new Map(createdUsers.map((u) => [u.email, u._id]));
  const titleByName = new Map(createdTitles.map((t) => [t.name, t._id]));
  const interactionRows = demoInteractions.map((row) => ({
    userId: userByEmail.get(row.user),
    titleId: titleByName.get(row.title),
    watchedSeconds: row.watched,
    completed: row.completed,
    rating: row.rating,
    coWatchedWith: row.co.map((email) => userByEmail.get(email)),
    lastWatchedAt: new Date(Date.now() - row.daysAgo * 86_400_000),
  }));
  await Interaction.insertMany(interactionRows);

  console.log('StreamSync seeded.');
  console.log(`  ${createdUsers.length} users, ${createdTitles.length} titles (${createdTitles.map((t) => t.timeline.length).reduce((a, b) => a + b, 0)} timeline events total), ${interactionRows.length} interaction rows`);
  console.table(users.map(({ email, password, role }) => ({ email, password, role })));
}

seed()
  .then(disconnectDB)
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
