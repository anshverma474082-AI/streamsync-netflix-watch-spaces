import mongoose from 'mongoose';

const variationOptionSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    label: { type: String, required: true },
    text: { type: String },
    assetRef: { type: String },
  },
  { _id: false }
);

const timelineEventSchema = new mongoose.Schema(
  {
    ts: { type: Number, required: true, min: 0 },
    type: {
      type: String,
      enum: ['scene', 'character', 'trivia', 'glossary', 'variationPoint'],
      required: true,
    },
    text: { type: String },
    characterId: { type: String },
    characterName: { type: String },
    term: { type: String },
    definition: { type: String },
    fromTs: { type: Number },
    toTs: { type: Number },
    variationId: { type: String },
    options: [variationOptionSchema],
    subtitleLocale: { type: String },
    weight: { type: Number, default: 1 },
  },
  { _id: false }
);

const titleSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    durationSeconds: { type: Number, required: true, min: 1 },
    genres: [{ type: String }],
    videoAssetUrl: { type: String, required: true },
    posterUrl: { type: String, default: '' },
    year: { type: Number },
    timeline: [timelineEventSchema],
  },
  { timestamps: true }
);

titleSchema.index({ name: 1 });

export default mongoose.model('Title', titleSchema);
