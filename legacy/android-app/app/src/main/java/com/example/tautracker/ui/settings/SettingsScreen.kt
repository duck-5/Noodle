package com.example.tautracker.ui.settings

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.example.tautracker.core.security.SecureStorage

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    secureStorage: SecureStorage,
    onBack: () -> Unit
) {
    var googleTasksEnabled by remember { mutableStateOf(false) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Settings") },
                navigationIcon = {
                    Button(onClick = onBack) {
                        Text("Back")
                    }
                }
            )
        }
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
                .padding(16.dp)
        ) {
            Text("Integrations", style = MaterialTheme.typography.titleLarge)
            Spacer(modifier = Modifier.height(16.dp))
            
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text("Sync with Google Tasks", style = MaterialTheme.typography.bodyLarge)
                Switch(
                    checked = googleTasksEnabled,
                    onCheckedChange = { googleTasksEnabled = it }
                )
            }
            if (googleTasksEnabled) {
                Spacer(modifier = Modifier.height(8.dp))
                Button(onClick = { /* TODO: Launch OAuth Flow */ }) {
                    Text("Connect Google Account")
                }
            }

            Spacer(modifier = Modifier.height(32.dp))
            Text("Dashboard Customization", style = MaterialTheme.typography.titleLarge)
            Spacer(modifier = Modifier.height(16.dp))
            
            Text("Widget ordering and course colors will be added here in a future update.", style = MaterialTheme.typography.bodyMedium)
        }
    }
}
