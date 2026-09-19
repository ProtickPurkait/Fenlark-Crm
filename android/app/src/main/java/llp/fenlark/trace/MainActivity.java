package llp.fenlark.trace;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(CallTrackerPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
