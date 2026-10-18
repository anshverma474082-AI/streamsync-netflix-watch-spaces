import mongoose from 'mongoose';

const interactionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    titleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Title', required: true, index: true },
    watchSpaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'WatchSpace' },
    watchedSeconds: { type: Number, required: true, min: 0 },
    completed: { type: Boolean, default: false },
    rating: { type: Number, min: 0, max: 5 },
    coWatchedWith: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    lastWatchedAt: { type: Date },
  },
  { timestamps: true }
);

export default mongoose.model('Interaction', interactionSchema);
