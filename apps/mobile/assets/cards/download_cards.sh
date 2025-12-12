#!/bin/bash

BASE_URL="https://www.tekeye.uk/playing_cards/images/svg_playing_cards/fronts"
SUITS=("hearts" "diamonds" "clubs" "spades")
RANKS=("ace" "2" "3" "4" "5" "6" "7" "8" "9" "10" "jack" "queen" "king")

echo "Downloading 52 playing card SVGs..."

for suit in "${SUITS[@]}"; do
  for rank in "${RANKS[@]}"; do
    filename="${suit}_${rank}.svg"
    url="${BASE_URL}/${filename}"
    echo "Downloading $filename..."
    curl -s -o "$filename" "$url"
    
    # Check if download was successful
    if [ -f "$filename" ] && [ -s "$filename" ]; then
      echo "✓ $filename downloaded"
    else
      echo "✗ Failed to download $filename"
    fi
  done
done

echo ""
echo "Download complete! Total files:"
ls -1 *.svg 2>/dev/null | wc -l
