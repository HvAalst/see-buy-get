# SeeBuyGet Driver — release shrinking (2026-11-02). The libraries bring their own keep rules (Firebase, the browser
# helper); the app's own classes are reached from the manifest, which the build keeps by itself.
#
# Guava (through the browser helper) names annotation classes it never needs at run time; without these lines R8 stops
# at "missing class".
-dontwarn com.google.errorprone.annotations.**
-dontwarn com.google.j2objc.annotations.**
-dontwarn javax.annotation.**
-dontwarn org.checkerframework.**
-dontwarn afu.org.checkerframework.**
-dontwarn org.codehaus.mojo.animal_sniffer.**
