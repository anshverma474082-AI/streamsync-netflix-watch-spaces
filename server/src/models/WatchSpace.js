import mongoose from 'mongoose';

const participantSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    joinedAt: { type: Date, default: Date.now },
    leftAt: { type: Date },
  },
  { _id: false }
);

const summaryParticipantSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId },
    displayName: String,
    watchedSeconds: Number,
  },
  { _id: false }
);

const watchSpaceSchema = new mongoose.Schema(
  {
    titleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Title', required: true },
    hostUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    inviteCode: { type: String, required: true, unique: true, uppercase: true },
    roomName: { type: String, default: '', trim: true, maxlength: 80 },
    status: { type: String, enum: ['scheduled', 'live', 'ended'], default: 'scheduled' },
    participants: [participantSchema],
    settings: {
      maxParticipants: { type: Number, default: 25, min: 2, max: 50 },
      aiVerbosity: { type: String, enum: ['minimal', 'normal', 'chatty'], default: 'normal' },
      votingEnabled: { type: Boolean, default: true },
      triviaEnabled: { type: Boolean, default: true },
      isLocked: { type: Boolean, default: false },
    },
    startedAt: { type: Date },
    endedAt: { type: Date },
    summary: {
      durationSeconds: Number,
      watchedSeconds: Number,
      peakParticipants: Number,
      aiQuestionsAsked: Number,
      triviaSurfaced: Number,
      chatVolume: Number,
      votesCast: Number,
      variationsApplied: Number,
      participants: [summaryParticipantSchema],
    },
  },
  { timestamps: true }
);

export default mongoose.model('WatchSpace', watchSpaceSchema);
