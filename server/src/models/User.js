import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    displayName: { type: String, required: true, trim: true, maxlength: 60 },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ['viewer', 'host', 'admin'], default: 'viewer' },
    preferences: {
      subtitleLocale: { type: String, default: 'en' },
      genreAffinity: [{ type: String }],
    },
  },
  { timestamps: true }
);

userSchema.methods.toPublicJSON = function () {
  return {
    id: this._id.toString(),
    email: this.email,
    displayName: this.displayName,
    role: this.role,
    preferences: this.preferences,
    createdAt: this.createdAt,
  };
};

export default mongoose.model('User', userSchema);
