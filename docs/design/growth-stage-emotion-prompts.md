# Growth Stage Emotion Prompts

Conclusion: use the fixed global prompt block plus one stage/emotion block to generate consistent assets for Baby, Teen, and Adult.

## Global Fixed Block
Use this block at the top of every request:

```text
Use the attached image as the exact character reference.
Do not change character identity, proportions, line style, or color palette.
Keep the same canvas size and exact anchor position.
Transparent background with alpha channel.
No background, no shadow, no glow, no blur.
Keep crisp outline and clean shading.
Export 1 PNG only.
```

## Baby Stage Prompts
### Baby Neutral
```text
Create a baby-stage version of the same cat character.
Emotion: neutral idle.
Keep a younger look (smaller body, softer face), while preserving identity.
strictly preserving the original image style.
File name: baby_neutral.png
```

### Baby Happy
```text
Create a baby-stage version of the same cat character.
Emotion: happy smile.
Use a gentle cheerful expression only.
strictly preserving the original image style.
File name: baby_happy.png
```

### Baby Sleep
```text
Create a baby-stage version of the same cat character.
Emotion: sleep.
Eyes closed, calm sleeping pose, minimal change.
strictly preserving the original image style.
File name: baby_sleep.png
```

### Baby Tired
```text
Create a baby-stage version of the same cat character.
Emotion: tired.
Slightly low-energy expression, no exaggerated distortion.
strictly preserving the original image style.
File name: baby_tired.png
```

### Baby Dirty
```text
Create a baby-stage version of the same cat character.
Emotion: dirty.
Add subtle messy cues only (small smudge marks), keep design clean.
strictly preserving the original image style.
File name: baby_dirty.png
```

## Teen Stage Prompts
### Teen Neutral
```text
Create a teen-stage version of the same cat character.
Emotion: neutral idle.
Keep identity and style; slightly taller/leaner than baby stage.
strictly preserving the original image style.
File name: teen_neutral.png
```

### Teen Happy
```text
Create a teen-stage version of the same cat character.
Emotion: happy smile.
Confident but cute expression.
strictly preserving the original image style.
File name: teen_happy.png
```

### Teen Sleep
```text
Create a teen-stage version of the same cat character.
Emotion: sleep.
Relaxed sleeping expression, no layout shift.
strictly preserving the original image style.
File name: teen_sleep.png
```

### Teen Tired
```text
Create a teen-stage version of the same cat character.
Emotion: tired.
Slightly exhausted look, maintain line quality and palette.
strictly preserving the original image style.
File name: teen_tired.png
```

### Teen Dirty
```text
Create a teen-stage version of the same cat character.
Emotion: dirty.
Add light dirt indicators only, avoid heavy effects.
strictly preserving the original image style.
File name: teen_dirty.png
```

## Adult Stage Prompts
### Adult Neutral
```text
Create an adult-stage version of the same cat character.
Emotion: neutral idle.
Mature but still chibi, preserve exact identity.
strictly preserving the original image style.
File name: adult_neutral.png
```

### Adult Happy
```text
Create an adult-stage version of the same cat character.
Emotion: happy smile.
Warm and friendly expression, no color shift.
strictly preserving the original image style.
File name: adult_happy.png
```

### Adult Sleep
```text
Create an adult-stage version of the same cat character.
Emotion: sleep.
Comfortable sleeping expression, minimal pose change.
strictly preserving the original image style.
File name: adult_sleep.png
```

### Adult Tired
```text
Create an adult-stage version of the same cat character.
Emotion: tired.
Low-energy expression, keep outline sharp.
strictly preserving the original image style.
File name: adult_tired.png
```

### Adult Dirty
```text
Create an adult-stage version of the same cat character.
Emotion: dirty.
Subtle unclean markers, avoid heavy effects.
strictly preserving the original image style.
File name: adult_dirty.png
```

## Save Paths
- Baby: `source/pet_emotions/main_cat/baby/`
- Teen: `source/pet_emotions/main_cat/teen/`
- Adult: `source/pet_emotions/main_cat/adult/`
