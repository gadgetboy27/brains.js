# Security Fix Guide - Remove Secrets from Git History

## The Problem
Your repository has sensitive data in git history:
1. .env file with API keys (commit 466e165)
2. data.js with crypto seed phrases (commit 466e165)

## Quick Fix Script

### Option 1: BFG Repo Cleaner (Fastest)

```bash
# 1. Backup your repo first!
cd /home/user
cp -r brains.js brains.js.backup

# 2. Download BFG Repo Cleaner
cd /home/user
wget https://repo1.maven.org/maven2/com/madgag/bfg/1.14.0/bfg-1.14.0.jar

# 3. Remove .env from history
cd /home/user/brains.js
java -jar ../bfg-1.14.0.jar --delete-files .env

# 4. Remove old data.js versions (we'll keep current clean version)
# First, create a file with the old sensitive content pattern
echo "at cost since owner series" > /tmp/patterns.txt
echo "kept website vats smidgen" >> /tmp/patterns.txt
git filter-branch --force --index-filter \
  "git rm --cached --ignore-unmatch data.js || true" \
  --prune-empty --tag-name-filter cat -- --all

# Add back the cleaned data.js
git add data.js
git commit -m "Add cleaned data.js without sensitive info"

# 5. Clean up and force push
git reflog expire --expire=now --all
git gc --prune=now --aggressive

# 6. Force push (THIS WILL REWRITE HISTORY)
git push origin --force --all
```

### Option 2: Git Filter-Repo (More Control)

```bash
# Install git-filter-repo
pip3 install git-filter-repo

cd /home/user/brains.js

# Remove .env from all history
git filter-repo --path .env --invert-paths

# Remove old data.js commits before the fix
git filter-repo --path data.js --commit-callback '
  if commit.original_id in [b"466e1653daa4c93fcd1c3e9bb43eb93f392fd224"]:
    commit.file_changes = [fc for fc in commit.file_changes if fc.filename != b"data.js"]
'

# Force push
git push origin --force --all
```

### Option 3: Nuclear Option - Start Fresh (Simplest)

```bash
# If you don't care about history before your Claude fixes:

cd /home/user/brains.js

# Keep only commits after the security fixes
git checkout claude/recognize-repo-help-011CV3xQKwkdn2oQ8zjcNJn2

# Create new repo with clean history
rm -rf .git
git init
git add .
git commit -m "Initial commit - cleaned repository"

# Force push to GitHub
git remote add origin https://github.com/gadgetboy27/brains.js.git
git push -u origin main --force
```

## After Cleaning History

1. **Rotate ALL exposed credentials:**
   - Foursquare API Client ID
   - Foursquare API Client Secret
   - Move funds from any exposed crypto wallets

2. **Update your local config.js** with new keys

3. **Verify the secrets are gone:**
   ```bash
   git log --all --full-history --source -- .env
   # Should return nothing

   git grep "UK32CEVITYO5AMHU3ZRAASDZ25QCODXPSJ2P0LW3ANSJ55E5" $(git rev-list --all)
   # Should return nothing
   ```

4. **GitHub will automatically close the security alerts** once the secrets are removed from history

## Prevention

Your current branch already has:
- ✅ .gitignore with .env and config.js
- ✅ Clean data.js without sensitive info
- ✅ config.example.js template

Just need to clean the history!

## Need Help?

The nuclear option (Option 3) is simplest if you don't need the old commit history.
Otherwise, Option 1 with BFG is the industry standard for this type of cleanup.
