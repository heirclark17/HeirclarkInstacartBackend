# How to Get Your Figma File Key

## Method 1: From Any Existing Figma File

1. **Go to Figma:** https://figma.com/files
2. **Open any file** you have access to
3. **Look at the URL in your browser:**
   ```
   https://www.figma.com/file/Ukg3ZxMBvqRXr9M7RN8P2o/Heirclark-App
                                 ↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑
                                This is the FILE KEY
   ```
4. **Copy just the file key part** (between `/file/` and the next `/`)

---

## Method 2: Create a New Test File

If you don't have any Figma files yet:

1. **Go to Figma:** https://figma.com
2. **Click "New design file"** (or press `Ctrl+N`)
3. **Draw something simple** (a rectangle, text, anything)
4. **Look at the URL** - copy the file key
5. **Give me the file key!**

---

## Method 3: Use Figma Community File

You can use any public Figma Community file:

1. **Go to:** https://www.figma.com/community
2. **Find any file** (search "design system" or "ui kit")
3. **Click "Duplicate"** to add it to your account
4. **Open the duplicated file**
5. **Copy the file key from the URL**

---

## What Happens Next?

Once you give me the file key, I'll:

✅ Fetch the complete file structure
✅ Extract all colors used in the design
✅ List all components and styles
✅ Show you the design data in JSON format
✅ Save everything to a local file

---

## Example

**If your URL is:**
```
https://www.figma.com/file/ABC123XYZ/My-Cool-Design
```

**Your file key is:**
```
ABC123XYZ
```

**Then I'll run:**
```bash
node fetch-figma-designs.js ABC123XYZ
```

---

**Just reply with your Figma file key and I'll fetch the designs!**
