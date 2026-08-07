package com.andrakim.sanctuarymodern;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RectF;
import android.view.MotionEvent;
import android.view.View;
import android.widget.Toast;

import java.util.ArrayList;
import java.util.List;

public class Level1View extends View {
    private static final float GAME_W = 1280f;
    private static final float GAME_H = 853f;

    private final Paint bgPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint gridPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint hotspotPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint textPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final List<Hotspot> hotspots = new ArrayList<>();

    private float scale = 1f;
    private float offsetX = 0f;
    private float offsetY = 0f;
    private String lastHit = "Touch a hotspot";

    private static class Hotspot {
        final String name;
        final float x, y, w, h;
        Hotspot(String name, float x, float y, float w, float h) {
            this.name = name;
            this.x = x;
            this.y = y;
            this.w = w;
            this.h = h;
        }
        boolean contains(float px, float py) {
            return px >= x - w / 2f && px <= x + w / 2f
                    && py >= y - h / 2f && py <= y + h / 2f;
        }
    }

    public Level1View(Context context) {
        super(context);
        setBackgroundColor(Color.BLACK);

        bgPaint.setColor(Color.rgb(26, 28, 31));
        gridPaint.setColor(Color.rgb(48, 52, 58));
        gridPaint.setStrokeWidth(1f);
        hotspotPaint.setStyle(Paint.Style.STROKE);
        hotspotPaint.setStrokeWidth(4f);
        hotspotPaint.setColor(Color.rgb(255, 210, 45));
        textPaint.setColor(Color.WHITE);
        textPaint.setTextSize(28f);
        textPaint.setShadowLayer(5f, 1f, 1f, Color.BLACK);

        // Reconstructed Level 1 positions from the original 1.2.2 Lua setup.
        add("anahtar", 226, 272, 76, 76);
        add("fener", 157, 320, 82, 82);
        add("pil", 550, 495, 72, 72);
        add("bicak", 340, 232, 78, 78);
        add("levye", 241, 190, 86, 86);
        add("kolakutusu", 480, 670, 74, 74);
        add("kanca", 876, 270, 80, 80);
        add("sopa", 1100, 700, 96, 96);
        add("tahta", 1188, 450, 90, 210);
        add("popupPile", 710, 623, 159, 83);
        add("popupCrack", 893, 692, 126, 57);
        add("popupCrackLighted", 863, 692, 126, 57);
        add("doorArea", 1185, 450, 184, 350);
        add("toyArea", 640, 695, 75, 36);
        add("chairArea", 235, 572, 81, 126);
        add("jarArea", 120, 534, 49, 75);
        add("shelfArea", 57, 333, 108, 163);
    }

    private void add(String name, float x, float y, float w, float h) {
        hotspots.add(new Hotspot(name, x, y, w, h));
    }

    @Override
    protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        float screenW = getWidth();
        float screenH = getHeight();
        scale = Math.min(screenW / GAME_W, screenH / GAME_H);
        offsetX = (screenW - GAME_W * scale) / 2f;
        offsetY = (screenH - GAME_H * scale) / 2f;

        canvas.save();
        canvas.translate(offsetX, offsetY);
        canvas.scale(scale, scale);

        canvas.drawRect(0, 0, GAME_W, GAME_H, bgPaint);
        for (int x = 0; x <= 1280; x += 80) canvas.drawLine(x, 0, x, GAME_H, gridPaint);
        for (int y = 0; y <= 853; y += 80) canvas.drawLine(0, y, GAME_W, y, gridPaint);

        for (Hotspot hs : hotspots) {
            RectF r = new RectF(hs.x - hs.w / 2f, hs.y - hs.h / 2f,
                    hs.x + hs.w / 2f, hs.y + hs.h / 2f);
            canvas.drawRect(r, hotspotPaint);
        }

        canvas.drawText("THE SANCTUARY — MODERN PORT", 24, 44, textPaint);
        canvas.drawText("Level 1 coordinate test • " + lastHit, 24, 82, textPaint);
        canvas.drawText("New Android runtime • target SDK 36 • no Corona libraries", 24, 120, textPaint);
        canvas.restore();
    }

    @Override
    public boolean onTouchEvent(MotionEvent event) {
        if (event.getAction() != MotionEvent.ACTION_UP) return true;

        float gx = (event.getX() - offsetX) / scale;
        float gy = (event.getY() - offsetY) / scale;
        if (gx < 0 || gy < 0 || gx > GAME_W || gy > GAME_H) return true;

        String found = null;
        float smallestArea = Float.MAX_VALUE;
        for (Hotspot hs : hotspots) {
            float area = hs.w * hs.h;
            if (hs.contains(gx, gy) && area < smallestArea) {
                found = hs.name;
                smallestArea = area;
            }
        }

        if (found == null) {
            found = String.format("x=%.0f y=%.0f", gx, gy);
        }
        lastHit = found;
        Toast.makeText(getContext(), found, Toast.LENGTH_SHORT).show();
        invalidate();
        return true;
    }
}
