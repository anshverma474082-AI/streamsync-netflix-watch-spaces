import mongoose from 'mongoose';

const reactionSchema = new mongoose.Schema(
  {
    emoji: { type: String, required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { _id: false }
);

const chatMessageSchema = new mongoose.Schema(
  {
    watchSpaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'WatchSpace', required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    msgType: { type: String, enum: ['chat', 'ai_answer', 'system'], default: 'chat' },
    body: { type: String, required: true, maxlength: 2000 },
    tsSeconds: { type: Number },
    reactions: [reactionSchema],
  },
  { timestamps: true }
);

export default mongoose.model('ChatMessage', chatMessageSchema);
